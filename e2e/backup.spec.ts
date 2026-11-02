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

  const heartbeat = async () => (await admin.from('heartbeats').select('at').eq('job', 'backup').maybeSingle()).data?.at;
  const lastBeat = await heartbeat();

  run(`node scripts/backup.mjs --local --out "${out}"`);

  // A run that saved its file leaves a heartbeat.
  expect(await heartbeat()).not.toBe(lastBeat);

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
  const allowedTime = 300_000;
  let dan: TestUser;

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
        'public.app_errors': saved('public.app_errors', `user_id in (${ids})`),
        'public.profiles': saved('public.profiles', `id in (${ids})`),
        'public.packs': saved('public.packs', `id = '${packId}'`),
        'public.critters': saved('public.critters', `pack_id = '${packId}'`),
        'public.pack_members': saved('public.pack_members', `pack_id = '${packId}'`),
        'public.feeds': saved('public.feeds', `pack_id = '${packId}'`),
        'public.reactions': saved('public.reactions', `feed_id in (select id from public.feeds where pack_id = '${packId}')`),
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

  test.beforeEach(async () => {
    test.setTimeout(allowedTime);
    psql('postgres', `drop database if exists ${target} with (force); create database ${target} template ${newProject};`);
    dan = await createUser('Dan');
  });

  test.afterEach(async () => {
    await removeUsers(dan);
  });

  test('a backup older than the schema leaves the newer columns their defaults', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    const backup = backUp([noa], pack.id);
    delete backup.tables['public.app_config']![0]!.apple_web_sign_in;

    restore(backup);

    expect(psql(target, 'select apple_web_sign_in from public.app_config')).toBe('f');
    expect(psql(target, `select name from public.packs where id = '${pack.id}'`)).toBe('Gym squad');
  });

  test('what a backup holds replaces what the migrations seeded', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    const backup = backUp([noa], pack.id);
    const config = {
      id: true,
      min_version: '1.2.0',
      ios_url: 'https://apps.apple.com/app/id1',
      android_url: 'https://play.google.com/store/apps/details?id=app.gozali',
      apple_revocation: true,
      apple_web_sign_in: true,
    };
    const [item, ...otherItems] = saved('public.shop_items', 'true');
    const [word] = saved('public.blocked_words', `match = 'word'`);
    backup.tables['public.app_config'] = [config];
    backup.tables['public.shop_items'] = [{ ...item, price: 999 }];
    backup.tables['public.blocked_words'] = [{ ...word, match: 'prefix' }];

    restore(backup);

    expect(JSON.parse(psql(target, 'select row_to_json(c) from public.app_config c'))).toEqual(config);
    expect(psql(target, `select price from public.shop_items where item = '${item!.item}'`)).toBe('999');
    expect(psql(target, `select match from public.blocked_words where word = '${word!.word}'`)).toBe('prefix');
    // A seeded row the backup doesn't hold is newer than the backup.
    expect(psql(target, 'select count(*) from public.shop_items')).toBe(String(otherItems.length + 1));
  });

  test('a row whose parent the backup missed is skipped, and the run says how many', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
    const fed = await admin
      .from('feeds')
      .insert([noa, dan].map((member) => ({ pack_id: pack.id, user_id: member.id, photo_path: `${member.name}.jpg`, day: '2026-10-29' })))
      .select('id, user_id');
    expect(fed.error).toBeNull();
    const noasFeed = fed.data!.find((row) => row.user_id === noa.id)!.id;
    const dansFeed = fed.data!.find((row) => row.user_id === dan.id)!.id;
    const reacted = await admin.from('reactions').insert([
      { feed_id: noasFeed, user_id: noa.id, emoji: 'fire' as const },
      { feed_id: noasFeed, user_id: dan.id, emoji: 'clap' as const },
      { feed_id: dansFeed, user_id: noa.id, emoji: 'muscle' as const },
    ]);
    expect(reacted.error).toBeNull();
    const reported = await admin
      .from('app_errors')
      .insert([noa, dan].map((member) => ({ user_id: member.id, message: 'test', platform: 'ios' })))
      .select('id, user_id');
    expect(reported.error).toBeNull();
    const backup = backUp([noa, dan], pack.id);
    // Dan signed up after the backup read the accounts, and before it read everything else.
    backup.tables['auth.users'] = backup.tables['auth.users']!.filter((row) => row.id !== dan.id);
    backup.tables['auth.identities'] = backup.tables['auth.identities']!.filter((row) => row.user_id !== dan.id);

    const printed = restore(backup);

    expect(printed).toContain('public.app_errors: 1, skipped 1');
    expect(printed).toContain('public.profiles: 1, skipped 1');
    expect(printed).toContain('public.pack_members: 1, skipped 1');
    expect(printed).toContain('public.feeds: 1, skipped 1');
    expect(printed).toContain('public.reactions: 1, skipped 2');
    expect(printed).toContain('Left out 6 rows');
    expect(psql(target, 'select id from public.profiles')).toBe(noa.id);
    expect(psql(target, 'select user_id from public.pack_members')).toBe(noa.id);
    expect(psql(target, 'select id from public.feeds')).toBe(noasFeed);
    expect(psql(target, 'select feed_id, user_id, emoji from public.reactions')).toBe(`${noasFeed}|${noa.id}|fire`);
    const noasReport = reported.data!.find((row) => row.user_id === noa.id)!.id;
    expect(psql(target, 'select id from public.app_errors')).toBe(String(noasReport));
    expect(psql(target, `select name from public.packs where id = '${pack.id}'`)).toBe('Gym squad');
    expect(psql(target, `select count(*) from pg_trigger where tgenabled = 'D'`)).toBe('0');
  });
});
