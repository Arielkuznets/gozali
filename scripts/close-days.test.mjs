// The day close, with the database stood in for, so nothing in this file needs one. The heartbeat
// saves a long gap since the last run as an outage, which the days in it need to know of, so a run
// whose heartbeat fails closes nothing and answers 500 for the owners' summary. An egg unlocks
// nothing until it hatches. The database's clock, which feeds count by, says when a pack's first
// open day is due; the runtime's Intl only lets the days after it follow in the same run.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import { closeAfterHeartbeat, closeDueDays, closeOneDay } from '../supabase/functions/close-days/close.ts';

const failing = { code: 'PGRST001', message: 'Database client error. Retrying the connection.' };

/** An RpcClient that answers with `answer` and notes the functions called, in order. */
function database(answer) {
  const called = [];
  return {
    called,
    rpc: async (fn) => {
      called.push(fn);
      return answer(fn);
    },
  };
}

test('the heartbeat goes before any day closes, and the run says whether it found an outage', async () => {
  const client = database((fn) => ({ data: fn === 'note_heartbeat' ? true : [], error: null }));
  const run = await closeAfterHeartbeat(client, new Date('2026-11-04T10:00:00Z'));
  assert.deepEqual(client.called, ['note_heartbeat', 'packs_to_close']);
  assert.deepEqual(run, { outage: true, closed: [], failed: [], deferred: 0 });
});

test('a run whose heartbeat fails closes nothing', async () => {
  const client = database((fn) => (fn === 'note_heartbeat' ? { data: null, error: failing } : { data: [], error: null }));
  await assert.rejects(closeAfterHeartbeat(client, new Date('2026-11-04T10:00:00Z')), /note_heartbeat/);
  assert.deepEqual(client.called, ['note_heartbeat']);
});

test('the function answers 500 for a failed heartbeat and asks for no day to close', async (t) => {
  registerHooks({ resolve: (specifier, context, next) => next(specifier.replace(/^npm:(.+)@\d+$/, '$1'), context) });
  const env = { SUPABASE_URL: 'http://database.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role', CRON_SECRET: 'close-days' };
  let closeDays;
  globalThis.Deno = { env: { get: (name) => env[name] }, serve: (handler) => (closeDays = handler) };
  await import('../supabase/functions/close-days/index.ts');
  const called = [];
  t.mock.method(globalThis, 'fetch', async (target) => {
    const rpc = /\/rpc\/(\w+)$/.exec(String(target))?.[1] ?? String(target);
    called.push(rpc);
    return rpc === 'note_heartbeat' ? Response.json(failing, { status: 503 }) : Response.json([]);
  });
  t.mock.method(console, 'error', () => {});

  const answer = await closeDays(new Request('http://close-days', { method: 'POST', headers: { 'x-cron-secret': 'close-days' } }));

  assert.equal(answer.status, 500);
  assert.deepEqual(called, ['note_heartbeat']);
});

/** day_close_input for an egg in a pack of eight, of whom `feeders` fed and the rest haven't started. */
function eggDay(feeders) {
  return {
    restDaysPerWeek: 1,
    critter: { status: 'egg', health: 100, xp: 0, stage: 'egg', streak: 0, marks: [] },
    members: Array.from({ length: 8 }, (_, index) => ({
      userId: `member-${index}`,
      membership: 'active',
      hasStarted: index < feeders,
      paused: false,
      fedToday: index < feeders,
      fedAtMinute: index < feeders ? 600 : null,
      jokerToday: false,
      restDeclaredToday: false,
      restDaysUsedThisWeek: 0,
      recentMisses: 0,
    })),
    totals: { fullHouseDays: 0, earlyBirdDays: 0, nightOwlFeeds: 0, countedFeeds: 0, members: 8 },
    unlocked: [],
  };
}

/** Closes the day of `input`, with no outage, and returns what apply_day_result was given. */
async function close(input) {
  let outcome;
  const client = {
    rpc: async (fn, args) => {
      if (fn === 'apply_day_result') outcome = args.outcome;
      return { data: fn === 'day_close_input' ? input : fn === 'apply_day_result', error: null };
    },
  };
  await closeOneDay(client, 'pack', '2026-11-03');
  return outcome;
}

test('an egg that stays an egg unlocks nothing, even in a full pack', async () => {
  const outcome = await close(eggDay(1));
  assert.equal(outcome.critter.status, 'egg');
  assert.deepEqual(outcome.achievements, []);
});

test('the day that hatches it unlocks what the pack reached before as well', async () => {
  const outcome = await close(eggDay(2));
  assert.equal(outcome.critter.status, 'active');
  assert.deepEqual(outcome.achievements, ['hatched', 'full_pack']);
});

/**
 * A database whose packs_to_close finds `due`, with no outage; `refuse` gives apply_day_result's
 * error for a pack, if any. `applied` lists the days closed, as 'pack day'.
 */
function closing(due, refuse = () => null) {
  const applied = [];
  return {
    applied,
    rpc: async (fn, args) => {
      if (fn === 'packs_to_close') return { data: due, error: null };
      if (fn === 'day_close_input') return { data: eggDay(2), error: null };
      if (fn === 'outage_on') return { data: false, error: null };
      const error = refuse(args.target);
      if (!error) applied.push(`${args.target} ${args.pack_date}`);
      return { data: !error, error };
    },
  };
}

test("the day packs_to_close finds due closes in a zone Intl can't read, and the next waits for the next run", async () => {
  const client = closing([{ pack_id: 'mars', time_zone: 'Mars/Olympus', next_day: '2026-11-03' }]);
  const run = await closeDueDays(client, new Date('2026-11-05T12:00:00Z'));
  assert.deepEqual(run.failed, []);
  assert.deepEqual(client.applied, ['mars 2026-11-03']);
});

test('the day packs_to_close finds due closes while Intl still puts its end later', async () => {
  // In Etc/GMT+12 Intl closes the day at 16:00 UTC, after this run, as a runtime whose zone data
  // is older than the database's does to Paraguay's days in winter.
  const client = closing([{ pack_id: 'behind', time_zone: 'Etc/GMT+12', next_day: '2026-11-03' }]);
  const run = await closeDueDays(client, new Date('2026-11-04T12:00:00Z'));
  assert.deepEqual(run.failed, []);
  assert.deepEqual(client.applied, ['behind 2026-11-03']);
});

test('the days after it close in the same run once they ended, oldest first, across a change of clocks', async () => {
  // Israel's clocks go back in the night after 2026-10-24, and 2026-10-25 closes at 02:00 UTC the next night.
  const due = [{ pack_id: 'late', time_zone: 'Asia/Jerusalem', next_day: '2026-10-23' }];
  const before = closing(due);
  await closeDueDays(before, new Date('2026-10-26T01:59:00Z'));
  assert.deepEqual(before.applied, ['late 2026-10-23', 'late 2026-10-24']);
  const after = closing(due);
  await closeDueDays(after, new Date('2026-10-26T02:00:00Z'));
  assert.deepEqual(after.applied, ['late 2026-10-23', 'late 2026-10-24', 'late 2026-10-25']);
});

test('a pack whose close fails is reported with its day, and the others still close', async () => {
  const client = closing(
    [
      { pack_id: 'deleted', time_zone: 'Asia/Jerusalem', next_day: '2026-11-03' },
      { pack_id: 'kept', time_zone: 'Asia/Jerusalem', next_day: '2026-11-03' },
    ],
    (pack) => (pack === 'deleted' ? { code: 'P0002', message: 'pack_not_found' } : null),
  );
  const run = await closeDueDays(client, new Date('2026-11-04T02:00:00Z'));
  assert.deepEqual(client.applied, ['kept 2026-11-03']);
  assert.deepEqual(
    run.failed.map(({ packId, day }) => ({ packId, day })),
    [{ packId: 'deleted', day: '2026-11-03' }],
  );
});
