// A backup of the database's data on this computer, since the free plan keeps none: every table in
// public and the accounts (auth.users, auth.identities), as one JSON file a day. Photo files are not
// included; they are deleted after 30 days anyway. It runs through the Supabase CLI, which is
// already signed in, so it needs no keys and no Docker. Keeps the newest 14 files.
//   node scripts/backup.mjs              the cloud project, into ~/Gozali backups
//   node scripts/backup.mjs --local      the local stack (to try a restore)
//   node scripts/backup.mjs --out <dir>
// Restore with scripts/restore.mjs.
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.includes('--local') ? '--local' : '--linked';
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : join(homedir(), 'Gozali backups');
const KEEP = 14;
const PAGE = 1000;

/** Runs SQL through the CLI and returns the rows. */
export function query(sql, where = target) {
  const file = join(tmpdir(), `gozali-query-${process.pid}.sql`);
  writeFileSync(file, sql);
  try {
    // One command line (npx is a script on Windows, so it runs through the shell); the SQL goes
    // through the file, never through the command line.
    const result = spawnSync(`npx supabase db query ${where} -f "${file}"`, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 1024,
    });
    const text = result.stdout ?? '';
    const start = text.indexOf('{');
    if (result.status !== 0 || text.includes('"_tag":"Error"')) {
      throw new Error(`query failed: ${`${text}\n${result.stderr ?? ''}`.trim().slice(0, 800)}`);
    }
    // A statement without rows (DO, UPDATE) prints only its name.
    return start < 0 ? [] : JSON.parse(text.slice(start)).rows;
  } finally {
    rmSync(file, { force: true });
  }
}

const json = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

/** Every table, saved into `out`; returns a line for the log. */
function backUp() {
  const tables = query(
    `select table_schema || '.' || table_name as name from information_schema.tables
     where table_type = 'BASE TABLE' and table_schema = 'public'
     union all select 'auth.users' union all select 'auth.identities' order by 1`,
  ).map((row) => row.name);

  const backup = { takenAt: new Date().toISOString(), source: target.slice(2), tables: {} };
  for (const table of tables) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = json(
        query(`select coalesce(json_agg(t), '[]'::json) as rows from (select * from ${table} order by 1 limit ${PAGE} offset ${offset}) t`)[0]
          .rows,
      );
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    backup.tables[table] = rows;
  }

  mkdirSync(out, { recursive: true });
  const name = `gozali-${backup.source}-${backup.takenAt.slice(0, 10)}.json`;
  const partial = join(out, `${name}.partial`);
  writeFileSync(partial, JSON.stringify(backup));
  renameSync(partial, join(out, name));

  const old = readdirSync(out)
    .filter((file) => file.startsWith(`gozali-${backup.source}-`) && file.endsWith('.json'))
    .sort()
    .slice(0, -KEEP);
  for (const file of old) rmSync(join(out, file));

  const counts = Object.entries(backup.tables).map(([table, rows]) => `${table.replace('public.', '')} ${rows.length}`);
  return `saved ${name}: ${counts.join(', ')}`;
}

// Run directly (not imported by restore.mjs): back up, and keep a log next to the backups, since
// the scheduled run has no window to show errors in.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(out, { recursive: true });
  const log = (line) => {
    console.log(line);
    appendFileSync(join(out, 'backup.log'), `${new Date().toISOString()} ${line}\n`);
  };
  try {
    log(backUp());
  } catch (error) {
    log(`FAILED ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
