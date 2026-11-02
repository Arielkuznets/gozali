// query() with the CLI's answers stubbed and its pauses skipped, so nothing here needs a database.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { query } from './backup.mjs';

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
