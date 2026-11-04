// The day close's heartbeat, with the database stood in for, so nothing in this file needs one. The
// heartbeat saves a long gap since the last run as an outage, which the days in it need to know of,
// so a run whose heartbeat fails closes nothing and answers 500 for the owners' summary.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

import { closeAfterHeartbeat } from '../supabase/functions/close-days/close.ts';

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
