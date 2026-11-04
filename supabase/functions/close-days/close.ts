// The day close (spec section 14): for every pack, each day that ended (grace window included)
// and has no result yet is run through the game engine and applied through apply_day_result,
// oldest first. Plain TypeScript that Deno (the Edge Function) and Node (the tests) both run.
import {
  addDays,
  closeDay,
  closesAt,
  newAchievements,
  type AchievementKey,
  type CritterState,
  type DayResult,
  type MemberDay,
} from '../../../packages/game-engine/src/index.ts';

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** day_close_input from the database. */
interface CloseInput {
  restDaysPerWeek: number;
  critter: CritterState;
  members: Array<Omit<MemberDay, 'fedAtMinute'> & { fedAtMinute: number | null }>;
  totals: { fullHouseDays: number; earlyBirdDays: number; nightOwlFeeds: number; countedFeeds: number; members: number };
  unlocked: AchievementKey[];
}

export interface ClosedDay {
  packId: string;
  day: string;
  result: DayResult;
  achievements: AchievementKey[];
}

async function call<T>(client: RpcClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${JSON.stringify(error)}`);
  return data as T;
}

/** Closes one day; null when another run closed it first. */
export async function closeOneDay(client: RpcClient, packId: string, day: string): Promise<ClosedDay | null> {
  const [input, outage] = await Promise.all([
    call<CloseInput>(client, 'day_close_input', { target: packId, pack_date: day }),
    // A day the service was down for an hour or more can't fail (outage_on, the outages table).
    call<boolean>(client, 'outage_on', { target: packId, pack_date: day }),
  ]);
  const result = closeDay({
    critter: input.critter,
    restDaysPerWeek: input.restDaysPerWeek,
    members: input.members.map((member) => ({ ...member, fedAtMinute: member.fedAtMinute ?? undefined })),
    outage,
  });
  const after = result.critter;
  const reached = newAchievements(
    {
      hatched: after.status !== 'egg',
      streak: after.streak,
      stage: after.stage,
      fullHouseDays: input.totals.fullHouseDays + (result.facts.fullHouse ? 1 : 0),
      earlyBirdDays: input.totals.earlyBirdDays + (result.facts.earlyBird ? 1 : 0),
      nightOwlFeeds: input.totals.nightOwlFeeds + result.facts.nightOwlFeeds,
      countedFeeds: input.totals.countedFeeds + result.feeds,
      // The bandage is the permanent mark of a return.
      returns: after.marks.includes('bandage') ? 1 : 0,
      members: input.totals.members,
    },
    new Set(input.unlocked),
  );
  // An egg wears nothing (spec section 4): what the pack reaches meanwhile unlocks on the day it
  // hatches, which counts from the same totals.
  const achievements = after.status === 'egg' ? [] : reached;
  const applied = await call<boolean>(client, 'apply_day_result', {
    target: packId,
    pack_date: day,
    outcome: { ...result, achievements },
  });
  return applied ? { packId, day, result, achievements } : null;
}

/**
 * Closes every day that is ready at `now`. A failing pack doesn't stop the others; its error is
 * reported and the next run tries again from the same day. `onlyPacks` limits the run (tests).
 */
/** How many packs close at once, and how long a run may keep starting packs. */
export const CLOSE_CONCURRENCY = 8;
export const CLOSE_BUDGET_MS = 90_000;

/**
 * Closes the due days of every pack, a few packs at a time; each pack's days go in order. Packs
 * in the same time zone all come due at the same moment, and a run has 2 s of CPU, enough for a
 * few hundred closes. Past that the function is killed with a 546: what closed stays closed, and
 * the next run goes on. Waiting for the database uses no CPU, so the time budget only matters
 * when the database is slow: a run then stops starting new packs and leaves the rest (`deferred`)
 * for the next run, before the function's 150 seconds run out.
 */
export async function closeDueDays(
  client: RpcClient,
  now: Date,
  onlyPacks?: readonly string[],
  budgetMs = CLOSE_BUDGET_MS,
): Promise<{ closed: ClosedDay[]; failed: Array<{ packId: string; day: string; error: string }>; deferred: number }> {
  const due = await call<Array<{ pack_id: string; time_zone: string; next_day: string }>>(client, 'packs_to_close', {
    at_time: now.toISOString(),
  });
  const queue = due.filter((pack) => !onlyPacks || onlyPacks.includes(pack.pack_id));
  const closed: ClosedDay[] = [];
  const failed: Array<{ packId: string; day: string; error: string }> = [];
  const started = Date.now();

  const closePack = async (pack: (typeof queue)[number]) => {
    let day = pack.next_day;
    try {
      for (; closesAt(day, pack.time_zone).getTime() <= now.getTime(); day = addDays(day, 1)) {
        const done = await closeOneDay(client, pack.pack_id, day);
        if (!done) break;
        closed.push(done);
      }
    } catch (error) {
      failed.push({ packId: pack.pack_id, day, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const worker = async () => {
    for (let pack = queue.shift(); pack; pack = queue.shift()) {
      await closePack(pack);
      if (Date.now() - started > budgetMs) return;
    }
  };
  await Promise.all(Array.from({ length: CLOSE_CONCURRENCY }, worker));
  return { closed, failed, deferred: queue.length };
}

/**
 * A run's heartbeat (note_heartbeat), then its day closes. The heartbeat saves a long gap since the
 * last run as an outage, which the days in it need to know of, so it goes first, and a run whose
 * heartbeat fails closes nothing: it throws, and the next run tries again with the gap still open.
 */
export async function closeAfterHeartbeat(
  client: RpcClient,
  now: Date,
): Promise<{ outage: boolean } & Awaited<ReturnType<typeof closeDueDays>>> {
  const outage = await call<boolean>(client, 'note_heartbeat', { job_name: 'close-days', at_time: now.toISOString() });
  return { outage: outage === true, ...(await closeDueDays(client, now)) };
}

/**
 * Deletes photo files older than 30 days (spec section 11) and forgets their paths, then files
 * no feed points at.
 */
export async function cleanupPhotos(
  client: RpcClient,
  removeFiles: (paths: string[]) => Promise<void>,
  now: Date,
): Promise<number> {
  const expired = await call<Array<{ feed_id: string; photo_path: string }>>(client, 'expired_photos', {
    at_time: now.toISOString(),
  });
  if (expired.length > 0) {
    await removeFiles(expired.map((row) => row.photo_path));
    await call(client, 'forget_photos', { feed_ids: expired.map((row) => row.feed_id) });
  }
  // Files no feed ever pointed at.
  const orphans = await call<string[]>(client, 'orphan_photos', { at_time: now.toISOString() });
  if (orphans.length > 0) await removeFiles(orphans);
  return expired.length + orphans.length;
}

/** Deletes the avatar files of accounts that are gone (deleted from the Auth dashboard). */
export async function cleanupAvatars(
  client: RpcClient,
  removeFiles: (paths: string[]) => Promise<void>,
  now: Date,
): Promise<number> {
  const orphans = await call<string[]>(client, 'orphan_avatars', { at_time: now.toISOString() });
  if (orphans.length > 0) await removeFiles(orphans);
  return orphans.length;
}

/** Deletes packs nobody has been in for 30 days (spec section 3), their photo files first. */
export async function dropEmptyPacks(
  client: RpcClient,
  removeFiles: (paths: string[]) => Promise<void>,
  now: Date,
): Promise<number> {
  const paths = await call<string[]>(client, 'empty_pack_photos', { at_time: now.toISOString() });
  if (paths.length > 0) await removeFiles(paths);
  return await call<number>(client, 'drop_empty_packs', { at_time: now.toISOString() });
}

/**
 * The cleanups of a run. They have nothing to do with each other, so one that fails doesn't stop
 * the next: its error comes back in `failed` for the run to report.
 */
export async function runCleanups(
  client: RpcClient,
  remover: (bucket: string) => (paths: string[]) => Promise<void>,
  now: Date,
): Promise<{ photos: number; droppedPacks: number; failed: Array<{ step: string; error: string }> }> {
  const failed: Array<{ step: string; error: string }> = [];
  const attempt = async (step: string, cleanup: () => Promise<number>) => {
    try {
      return await cleanup();
    } catch (error) {
      failed.push({ step, error: error instanceof Error ? error.message : String(error) });
      return 0;
    }
  };
  const removeFiles = remover('feed-photos');
  const photos = await attempt('photos', () => cleanupPhotos(client, removeFiles, now));
  const avatars = await attempt('avatars', () => cleanupAvatars(client, remover('avatars'), now));
  const droppedPacks = await attempt('packs', () => dropEmptyPacks(client, removeFiles, now));
  return { photos: photos + avatars, droppedPacks, failed };
}
