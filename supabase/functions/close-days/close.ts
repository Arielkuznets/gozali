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
  const achievements = newAchievements(
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
export async function closeDueDays(
  client: RpcClient,
  now: Date,
  onlyPacks?: readonly string[],
): Promise<{ closed: ClosedDay[]; failed: Array<{ packId: string; day: string; error: string }> }> {
  const due = await call<Array<{ pack_id: string; time_zone: string; next_day: string }>>(client, 'packs_to_close', {
    at_time: now.toISOString(),
  });
  const closed: ClosedDay[] = [];
  const failed: Array<{ packId: string; day: string; error: string }> = [];
  for (const pack of due) {
    if (onlyPacks && !onlyPacks.includes(pack.pack_id)) continue;
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
  }
  return { closed, failed };
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
