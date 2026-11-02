// query() with the CLI's answers stubbed and its pauses skipped, and the check of a page on rows made
// here, so nothing in this file needs a database.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { emptyUnwritable, query } from './backup.mjs';

const real = childProcess.spawnSync;
const failed = { status: 1, stdout: '', stderr: 'failed to connect to postgres: Connection timed out' };
const answered = { status: 0, stdout: '[{"ok":1}]', stderr: '' };
const cutShort = { status: 0, stdout: '[{"ok"', stderr: '' };
let pauses;

/** The CLI gives these answers in turn, then keeps giving the last one. */
function cliAnswers(...answers) {
  let calls = 0;
  childProcess.spawnSync = () => answers[Math.min(calls++, answers.length - 1)];
  syncBuiltinESMExports();
  return () => calls;
}

beforeEach(() => {
  pauses = [];
  mock.method(Atomics, 'wait', (_array, _index, _value, ms) => {
    pauses.push(ms);
    return 'timed-out';
  });
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
  childProcess.spawnSync = real;
  syncBuiltinESMExports();
});

test('a call the CLI fails is tried again, and its answer comes back', () => {
  const calls = cliAnswers(failed, failed, answered);
  assert.deepEqual(query('select 1 as ok', '--local'), [{ ok: 1 }]);
  assert.equal(calls(), 3);
  assert.deepEqual(pauses, [5_000, 30_000]);
});

test('an answer cut short is asked for again', () => {
  const calls = cliAnswers(cutShort, answered);
  assert.deepEqual(query('select 1 as ok', '--local'), [{ ok: 1 }]);
  assert.equal(calls(), 2);
});

test('a call that keeps failing gives up after about two and a half minutes, with the reason', () => {
  const calls = cliAnswers(failed);
  assert.throws(() => query('select 1 as ok', '--local'), /Connection timed out/);
  assert.equal(calls(), 4);
  assert.deepEqual(pauses, [5_000, 30_000, 120_000]);
});

test('a call that works is sent once', () => {
  const calls = cliAnswers(answered);
  assert.deepEqual(query('select 1 as ok', '--local'), [{ ok: 1 }]);
  assert.equal(calls(), 1);
  assert.deepEqual(pauses, []);
});

const nested = (depth) => JSON.parse(`${'['.repeat(depth)}${']'.repeat(depth)}`);
const account = (id, depth) => ({ id, raw_app_meta_data: { provider: 'email' }, raw_user_meta_data: { list: nested(depth) } });

test('a page the file can hold stays as it is, for one stringify', () => {
  const page = [account('noa', 3), account('dan', 1)];
  const stringify = mock.method(JSON, 'stringify');
  const emptied = emptyUnwritable('auth.users', page, ['id']);
  assert.equal(stringify.mock.callCount(), 1);
  stringify.mock.restore();
  assert.deepEqual(emptied, []);
  assert.deepEqual(page, [account('noa', 3), account('dan', 1)]);
});

test('a column nested too deep goes empty on its own, and the run is told which', () => {
  const page = [account('noa', 1), account('deep', 6000), account('dan', 1)];
  assert.deepEqual(emptyUnwritable('auth.users', page, ['id']), ['auth.users deep raw_user_meta_data']);
  assert.deepEqual(page, [
    account('noa', 1),
    { id: 'deep', raw_app_meta_data: { provider: 'email' }, raw_user_meta_data: {} },
    account('dan', 1),
  ]);
});

test('a row is named by its whole key', () => {
  const page = [{ pack_id: 'gym', week: '2026-11-02', stats: nested(6000) }];
  assert.deepEqual(emptyUnwritable('public.weekly_recaps', page, ['pack_id', 'week']), ['public.weekly_recaps gym 2026-11-02 stats']);
});

test('nothing at the limit gets past the check and then stops the file', () => {
  const written = (rows) => ({ takenAt: '2026-11-03T00:00:00.000Z', source: 'local', tables: { 'auth.users': rows } });
  let deepest = 1000;
  for (let step = 8192; step >= 1; step /= 2) {
    try {
      JSON.stringify(written([account('noa', deepest + step)]));
      deepest += step;
    } catch {
      // Past the limit, so the next step is smaller.
    }
  }
  for (let depth = deepest - 16; depth <= deepest + 16; depth += 1) {
    const page = [account('noa', depth)];
    emptyUnwritable('auth.users', page, ['id']);
    JSON.stringify(written(page));
  }
});
