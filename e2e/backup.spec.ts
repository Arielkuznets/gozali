// The backup and restore scripts against the local stack: no app, just the file they share.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, removeUsers, type TestUser } from './support';

const root = fileURLToPath(new URL('..', import.meta.url));
let noa: TestUser;
let out: string;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  out = mkdtempSync(join(tmpdir(), 'gozali-backup-'));
});

test.afterEach(async () => {
  await removeUsers(noa);
  rmSync(out, { recursive: true, force: true });
});

function run(command: string) {
  const result = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8' });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

test('a backup keeps every row of a table longer than one page', async () => {
  test.setTimeout(180_000);
  const packs = [
    await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }),
    await createPack(noa, { name: 'Morning runs', habit: 'running', species: 'hoot' }),
    await createPack(noa, { name: 'Reading club', habit: 'reading', species: 'bun' }),
  ];
  // Four years of closed days, a day at a time like the day close writes them: five pages of rows,
  // each pack's sharing the first column.
  const days = Array.from({ length: 1500 }, (_, n) => new Date(Date.UTC(2022, 0, 1 + n)).toISOString().slice(0, 10));
  const rows = days.flatMap((day) =>
    packs.map((pack) => ({ pack_id: pack.id, day, result: 'success' as const, applied: true, health_before: 50, health_after: 60 })),
  );
  const inserted = await admin.from('day_results').insert(rows);
  expect(inserted.error).toBeNull();
  // The statistics a live table has by the time the night's backup runs.
  run('npx supabase db query --local "analyze public.day_results"');

  run(`node scripts/backup.mjs --local --out "${out}"`);

  const file = readdirSync(out).find((name) => name.endsWith('.json'))!;
  const backup = JSON.parse(readFileSync(join(out, file), 'utf8')) as { tables: Record<string, { pack_id: string; day: string }[]> };
  const ours = new Set(packs.map((pack) => pack.id));
  const saved = new Set(
    backup.tables['public.day_results']!.filter((row) => ours.has(row.pack_id)).map((row) => `${row.pack_id} ${row.day}`),
  );
  expect(saved.size).toBe(rows.length);
});

test.describe('a restore', () => {
  type Row = Record<string, unknown>;
  const stack = 'supabase_db_gozali';
  const newProject = 'gozali_restore_new_project';
  const target = 'gozali_restore_target';
  const allowedTime = 180_000;

  function psql(database: string, sql: string) {
    const args = ['exec', '-i', stack, 'psql', '-U', 'supabase_admin', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'];
    const result = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  }

  function copyToNewProject(dump: string) {
    const copy = `pg_dump -U supabase_admin -d postgres ${dump} | psql -U supabase_admin -d ${newProject} -q`;
    expect(spawnSync('docker', ['exec', stack, 'sh', '-c', copy]).status).toBe(0);
  }

  /** Rows of the local stack, the way the backup script saves them. */
  function saved(table: string, where: string): Row[] {
    return JSON.parse(psql('postgres', `select coalesce(json_agg(t), '[]') from (select * from ${table} as r where ${where} order by (r.*)) t`));
  }

  /** A backup holding the accounts, the app settings and one pack, nothing else. */
  function backUp(users: TestUser[], packId: string): { tables: Record<string, Row[]> } {
    const ids = users.map((user) => `'${user.id}'`).join(', ');
    return {
      tables: {
        'auth.users': saved('auth.users', `id in (${ids})`),
        'auth.identities': saved('auth.identities', `user_id in (${ids})`),
        'public.app_config': saved('public.app_config', 'true'),
        'public.profiles': saved('public.profiles', `id in (${ids})`),
        'public.packs': saved('public.packs', `id = '${packId}'`),
        'public.critters': saved('public.critters', `pack_id = '${packId}'`),
        'public.pack_members': saved('public.pack_members', `pack_id = '${packId}'`),
      },
    };
  }

  function restore(backup: { tables: Record<string, Row[]> }) {
    const file = join(out, 'backup.json');
    writeFileSync(file, JSON.stringify({ takenAt: '2026-10-29T18:30:00.000Z', source: 'linked', ...backup }));
    return run(`node scripts/restore.mjs "${file}" --local --database ${target}`);
  }

  // A database like a new project after `db push`: the schema and what the migrations seed. Only
  // the cron jobs are missing, since pg_cron lives in one database of the stack.
  test.beforeAll(() => {
    test.setTimeout(allowedTime);
    psql('postgres', `drop database if exists ${newProject} with (force); create database ${newProject} owner postgres;`);
    copyToNewProject('--schema-only');
    copyToNewProject('--data-only -t public.app_config -t public.blocked_words -t public.shop_items');
  });

  test.afterAll(() => {
    psql('postgres', `drop database if exists ${target} with (force); drop database if exists ${newProject} with (force);`);
  });

  test.beforeEach(() => {
    test.setTimeout(allowedTime);
    psql('postgres', `drop database if exists ${target} with (force); create database ${target} template ${newProject};`);
  });

  test('a backup older than the schema leaves the newer columns their defaults', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    const backup = backUp([noa], pack.id);
    delete backup.tables['public.app_config']![0]!.apple_web_sign_in;

    restore(backup);

    expect(psql(target, 'select apple_web_sign_in from public.app_config')).toBe('f');
    expect(psql(target, `select name from public.packs where id = '${pack.id}'`)).toBe('Gym squad');
  });
});
