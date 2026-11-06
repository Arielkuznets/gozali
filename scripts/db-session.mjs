// Connections of their own to the local database, for the smoke tests' checks of what only goes
// wrong at the same moment: a transaction held open while a call runs beside it.
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

/**
 * A connection of its own, for what the API can't do: stay inside a transaction while a call runs
 * beside it. `run` sends SQL and gives back what psql printed. `close` ends the connection, which
 * rolls back anything still open.
 */
export function openSession() {
  const psql = spawn('docker', [
    'exec', '-i', 'supabase_db_gozali', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1',
  ]);
  const closed = new Promise((resolve) => psql.once('close', resolve));
  let printed = '';
  let errors = '';
  let sent = 0;
  psql.stdout.on('data', (text) => (printed += text));
  psql.stderr.on('data', (text) => (errors += text));
  // A psql that didn't start or has stopped shows in run, which then throws.
  psql.on('error', (error) => (errors += error.message));
  psql.stdin.on('error', () => {});
  return {
    async run(sql) {
      const done = `done ${++sent}`;
      psql.stdin.write(`${sql}\n\\echo '${done}'\n`);
      for (;;) {
        const end = printed.indexOf(done);
        if (end >= 0) {
          const answer = printed.slice(0, end).trim();
          printed = '';
          return answer;
        }
        if (psql.exitCode !== null) throw new Error(`psql stopped: ${errors}`);
        await wait(5);
      }
    },
    close() {
      psql.stdin.end();
      return closed;
    },
  };
}

/** Runs `held` in a transaction left open, starts `call`, and commits once `call` waits on it or is done. */
export async function whileOpen(held, call) {
  const session = openSession();
  try {
    await session.run(`begin; ${held}`);
    let finished = false;
    const answer = Promise.resolve(call()).finally(() => (finished = true));
    // Handled here too, or a call failing during the wait would stop the run before any cleanup.
    answer.catch(() => {});
    // A transaction keeps its first read of pg_stat_activity, and would never see a new connection.
    const blocked = `select pg_stat_clear_snapshot();
      select count(*) from pg_stat_activity a where pg_backend_pid() = any (pg_blocking_pids(a.pid));`;
    while (!finished && (await session.run(blocked)) === '0') await wait(20);
    await session.run('commit;');
    return await answer;
  } finally {
    await session.close();
  }
}

/** SQL run the way a call of that person runs it. */
export function as(person, sql) {
  const claims = JSON.stringify({ sub: person.id, role: 'authenticated' });
  return `set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); ${sql}; reset role;`;
}
