// The day close, with the database stood in for, so nothing in this file needs one. The heartbeat
// saves a long gap since the last run as an outage, which the days in it need to know of, so a run
// whose heartbeat fails closes nothing and answers 500 for the owners' summary. An egg unlocks
// nothing until it hatches.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import { closeAfterHeartbeat, closeOneDay } from '../supabase/functions/close-days/close.ts';

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
