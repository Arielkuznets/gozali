// The backup and restore scripts against the local stack: no app, just the file they share.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, removeUsers, type TestUser } from './support';

const root = fileURLToPath(new URL('..', import.meta.url));
const stack = 'supabase_db_gozali';
let noa: TestUser;
let out: string;
// Accounts a test makes beyond Noa. They go in afterEach, which runs after a test out of time too: a
// value too deep for the file stays a problem for every other backup here until its account goes.
const accounts: string[] = [];

test.beforeEach(async () => {
  noa = await createUser('Noa');
  out = mkdtempSync(join(tmpdir(), 'gozali-backup-'));
});

test.afterEach(async () => {
  await removeUsers(noa);
  for (const id of accounts.splice(0)) await admin.auth.admin.deleteUser(id);
  rmSync(out, { recursive: true, force: true });
});

function run(command: string, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, { cwd: root, shell: true, encoding: 'utf8', env });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return result.stdout;
}

function psql(database: string, sql: string) {
  const args = ['exec', '-i', stack, 'psql', '-U', 'supabase_admin', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'];
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

test('a backup keeps every row of a table longer than one page', async () => {
  test.setTimeout(300_000);
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

  // One of these rows goes while the run reads the second page, from the part it has already read.
  const gone = { pack_id: packs.map((pack) => pack.id).sort()[0]!, day: days[0]! };
  const secondPage = join(out, 'second-page.sql');
  run(`node --require ./e2e/between-pages.cjs scripts/backup.mjs --local --out "${out}"`, {
    ...process.env,
    PAGED_TABLE: 'public.day_results',
    SECOND_PAGE_SQL: secondPage,
    BETWEEN_PAGES: `delete from public.day_results where pack_id = '${gone.pack_id}' and day = '${gone.day}'`,
  });

  // A run that saved its file leaves a heartbeat.
  expect(await heartbeat()).not.toBe(lastBeat);

  const left = await admin.from('day_results').select('day').eq('pack_id', gone.pack_id).eq('day', gone.day);
  expect(left.data).toEqual([]);
  const file = readdirSync(out).find((name) => name.endsWith('.json'))!;
  const backup = JSON.parse(readFileSync(join(out, file), 'utf8')) as { tables: Record<string, { pack_id: string; day: string }[]> };
  const label = (row: { pack_id: string; day: string }) => `${row.pack_id} ${row.day}`;
  const saved = backup.tables['public.day_results']!.map(label);
  expect(saved.length).toBe(new Set(saved).size);
  const inFile = new Set(saved);
  const live = rows.map(label).filter((row) => row !== label(gone));
  expect(live.filter((row) => !inFile.has(row))).toEqual([]);

  // The page is a range of the key's index, not a sort of the whole table. A table this small might
  // get a sequential scan on its merits, so the plan is asked for without them.
  const plan = psql('postgres', `set enable_seqscan = off; explain (costs off) ${readFileSync(secondPage, 'utf8')}`);
  expect(plan).toContain('Index');
  expect(plan).not.toContain('Sort');
});

test('a value nested deeper than the file can hold is left out, and the run names it', async () => {
  test.setTimeout(600_000);
  // What anyone can send with the app's public key. The bodies are written out by hand, since
  // JSON.stringify can't nest this deep.
  const auth = (path: string, method: string, body: string, token?: string) =>
    fetch(`${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/auth/v1/${path}`, {
      method,
      body,
      headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY!,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  const nested = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`;
  const live = (table: string, where: string) => JSON.parse(psql('postgres', `select row_to_json(r) from ${table} r where ${where}`));
  const dan = await createUser('Dan');
  accounts.push(dan.id);

  // The deepest the auth server takes, in the account's own metadata.
  expect((await auth('user', 'PUT', `{"data":{"list":${nested(9998)}}}`, noa.session.access_token)).status).toBe(200);
  // A sign-up copies what it is given into the identity as well.
  const email = `sam-e2e-${Date.now()}@gozali.test`;
  const signedUp = await auth('signup', 'POST', `{"email":"${email}","password":"e2e-password","data":{"list":${nested(6000)}}}`);
  expect(signedUp.status).toBe(200);
  const sam = ((await signedUp.json()) as { user: { id: string } }).user.id;
  accounts.push(sam);

  const heartbeat = async () => (await admin.from('heartbeats').select('at').eq('job', 'backup').maybeSingle()).data?.at;
  const lastBeat = await heartbeat();
  run(`node scripts/backup.mjs --local --out "${out}"`);
  expect(await heartbeat()).not.toBe(lastBeat);

  const file = readdirSync(out).find((name) => name.endsWith('.json'))!;
  const { tables } = JSON.parse(readFileSync(join(out, file), 'utf8')) as { tables: Record<string, Record<string, unknown>[]> };
  const account = (id: string) => tables['auth.users']!.find((row) => row.id === id);
  const identity = (id: string) => tables['auth.identities']!.find((row) => row.user_id === id);

  // Everything else of those accounts is saved, and the value goes on its own: a change of metadata
  // doesn't reach the identity.
  expect(account(noa.id)).toEqual({ ...live('auth.users', `id = '${noa.id}'`), raw_user_meta_data: {} });
  expect(identity(noa.id)).toEqual(live('auth.identities', `user_id = '${noa.id}'`));
  expect(account(sam)).toEqual({ ...live('auth.users', `id = '${sam}'`), raw_user_meta_data: {} });
  const samsIdentity = live('auth.identities', `user_id = '${sam}'`);
  expect(identity(sam)).toEqual({ ...samsIdentity, identity_data: {} });

  // The account beside them comes through untouched, and all three keep what the tables hold.
  expect(account(dan.id)).toEqual(live('auth.users', `id = '${dan.id}'`));
  expect(identity(dan.id)).toEqual(live('auth.identities', `user_id = '${dan.id}'`));
  for (const id of [noa.id, sam, dan.id]) {
    expect(tables['public.profiles']!.find((row) => row.id === id)).toEqual(live('public.profiles', `id = '${id}'`));
  }

  const log = readFileSync(join(out, 'backup.log'), 'utf8');
  expect(log).toContain(`saved ${file}: `);
  expect(log).toContain(`auth.users ${noa.id} raw_user_meta_data`);
  expect(log).toContain(`auth.users ${sam} raw_user_meta_data`);
  expect(log).toContain(`auth.identities ${samsIdentity.id} identity_data`);
  expect(log).not.toContain(dan.id);
});

test.describe('a restore', () => {
  type Row = Record<string, unknown>;
  const newProject = 'gozali_restore_new_project';
  const target = 'gozali_restore_target';
  const allowedTime = 300_000;
  let dan: TestUser;
  let others: TestUser[] = [];

  function copyToNewProject(dump: string) {
    const copy = `pg_dump -U supabase_admin -d postgres ${dump} | psql -U supabase_admin -d ${newProject} -q`;
    expect(spawnSync('docker', ['exec', stack, 'sh', '-c', copy]).status).toBe(0);
  }

  /** Rows of the local stack, the way the backup script saves them. */
  function saved(table: string, where: string): Row[] {
    return JSON.parse(psql('postgres', `select coalesce(json_agg(t), '[]') from (select * from ${table} as r where ${where} order by (r.*)) t`));
  }

  /** A backup holding the accounts, the app settings and these packs, nothing else. */
  function backUp(users: TestUser[], ...packIds: string[]): { tables: Record<string, Row[]> } {
    const ids = users.map((user) => `'${user.id}'`).join(', ');
    const packs = packIds.map((id) => `'${id}'`).join(', ');
    return {
      tables: {
        'auth.users': saved('auth.users', `id in (${ids})`),
        'auth.identities': saved('auth.identities', `user_id in (${ids})`),
        'public.app_config': saved('public.app_config', 'true'),
        'public.app_errors': saved('public.app_errors', `user_id in (${ids})`),
        'public.profiles': saved('public.profiles', `id in (${ids})`),
        'public.packs': saved('public.packs', `id in (${packs})`),
        'public.critters': saved('public.critters', `pack_id in (${packs})`),
        'public.pack_members': saved('public.pack_members', `pack_id in (${packs})`),
        'public.feeds': saved('public.feeds', `pack_id in (${packs})`),
        'public.reactions': saved('public.reactions', `feed_id in (select id from public.feeds where pack_id in (${packs}))`),
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
    await removeUsers(dan, ...others);
    others = [];
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
    const otherWords = saved('public.blocked_words', `word <> '${word!.word}'`);
    backup.tables['public.app_config'] = [config];
    backup.tables['public.shop_items'] = [{ ...item, price: 999 }];
    backup.tables['public.blocked_words'] = [{ ...word, match: 'prefix' }];

    const printed = restore(backup);

    expect(JSON.parse(psql(target, 'select row_to_json(c) from public.app_config c'))).toEqual(config);
    expect(psql(target, `select price from public.shop_items where item = '${item!.item}'`)).toBe('999');
    expect(psql(target, `select match from public.blocked_words where word = '${word!.word}'`)).toBe('prefix');
    // A seeded row the backup doesn't hold stays, since it can be newer than the backup, and the run
    // names it, since it can also be one the owner had removed.
    expect(psql(target, 'select count(*) from public.shop_items')).toBe(String(otherItems.length + 1));
    const named = (table: string) => new RegExp(`${table} \\(([^)]*)\\)`).exec(printed)?.[1]?.split(', ').sort();
    expect(printed).toContain('Seeded rows the backup lacks: ');
    expect(named('public.shop_items')).toEqual(otherItems.map((row) => row.item).sort());
    expect(named('public.blocked_words')).toEqual(otherWords.map((row) => row.word).sort());
    expect(named('public.app_config')).toBeUndefined();
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

  test('a row whose key goes empty with its parent in the database stays, without that key', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
    const [first, second] = saved('public.shop_items', 'true').map((row) => row.item as string);
    const bought = await admin.from('pack_items').insert([
      { pack_id: pack.id, item: first!, bought_by: dan.id },
      { pack_id: pack.id, item: second!, bought_by: noa.id },
    ]);
    expect(bought.error).toBeNull();
    const event = await admin.from('pack_events').insert({ pack_id: pack.id, kind: 'bought', actor_id: noa.id, payload: { item: second } });
    expect(event.error).toBeNull();
    const backup = backUp([noa, dan], pack.id);
    const items = saved('public.pack_items', `pack_id = '${pack.id}'`);
    const dansItem = items.find((row) => row.bought_by === dan.id)!;
    // Other keys have no empty value to fall back on: these two rows are skipped.
    backup.tables['public.pack_items'] = [
      ...items,
      { ...dansItem, item: 'no_such_item' },
      { ...dansItem, pack_id: '00000000-0000-4000-a000-000000000001' },
    ];
    backup.tables['public.pack_events'] = saved('public.pack_events', `pack_id = '${pack.id}'`);
    // Dan deleted the account after the backup read these tables, and before it read the profiles.
    backup.tables['public.profiles'] = backup.tables['public.profiles']!.filter((row) => row.id !== dan.id);

    const printed = restore(backup);

    expect(printed).toContain('public.pack_items: 2, skipped 2');
    expect(printed).toContain('public.pack_events: 2\n');
    expect(psql(target, `select bought_by from public.pack_items where item = '${first}'`)).toBe('');
    expect(psql(target, `select bought_by from public.pack_items where item = '${second}'`)).toBe(noa.id);
    expect(psql(target, `select actor_id from public.pack_events where kind = 'joined'`)).toBe('');
    expect(psql(target, `select actor_id from public.pack_events where kind = 'bought'`)).toBe(noa.id);
  });

  test('a pack whose admin the backup missed passes to its longest-standing member', async () => {
    const sam = await createUser('Sam');
    const ana = await createUser('Ana');
    others = [sam, ana];
    // Sam joined first and left, so Noa has stood longest of those still in the pack.
    const pack = await createPack(dan, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [sam, noa, ana]);
    const left = await sam.client.rpc('leave_pack', { target: pack.id });
    expect(left.error).toBeNull();
    const settled = await createPack(ana, { name: 'Morning runs', habit: 'running', species: 'hoot' }, [noa]);
    const backup = backUp([noa, dan, sam, ana], pack.id, settled.id);
    // Dan deleted the account after the backup read the members, and before it read the profiles.
    backup.tables['public.profiles'] = backup.tables['public.profiles']!.filter((row) => row.id !== dan.id);

    restore(backup);

    const admins = (id: string) => psql(target, `select user_id from public.pack_members where pack_id = '${id}' and role = 'admin'`);
    expect(admins(pack.id)).toBe(noa.id);
    expect(admins(settled.id)).toBe(ana.id);
    expect(psql(target, 'select count(*) from public.pack_events')).toBe('0');
  });

  test('an account the backup caught being deleted is deleted again, and the run names it', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
    const backup = backUp([noa, dan], pack.id);
    // Dan deleted the account after the backup read the accounts, and before it read the profiles.
    backup.tables['public.profiles'] = backup.tables['public.profiles']!.filter((row) => row.id !== dan.id);

    const printed = restore(backup);

    expect(psql(target, 'select id from auth.users')).toBe(noa.id);
    expect(psql(target, 'select user_id from auth.identities')).toBe(noa.id);
    expect(psql(target, 'select user_id from public.pack_members')).toBe(noa.id);
    expect(printed).toContain(`Deleted 1 account the backup caught being deleted: ${dan.id}.`);
  });

  test('a pack the backup caught being made, without its critter, stays out with all it holds', async () => {
    const older = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
    const newer = await createPack(noa, { name: 'Morning runs', habit: 'running', species: 'hoot' }, [dan]);
    const fed = await admin
      .from('feeds')
      .insert([older, newer].map((pack, n) => ({ pack_id: pack.id, user_id: noa.id, photo_path: `${n}.jpg`, day: '2026-10-29' })))
      .select('id, pack_id');
    expect(fed.error).toBeNull();
    const reacted = await admin.from('reactions').insert(fed.data!.map((row) => ({ feed_id: row.id, user_id: dan.id, emoji: 'fire' as const })));
    expect(reacted.error).toBeNull();
    const backup = backUp([noa, dan], older.id, newer.id);
    // The second pack was made after the backup, begun at 18:30, read critters.
    for (const row of backup.tables['public.packs']!) {
      row.created_at = row.id === newer.id ? '2026-10-29T18:31:00+00:00' : '2026-03-01T09:00:00+00:00';
    }
    backup.tables['public.critters'] = backup.tables['public.critters']!.filter((row) => row.pack_id !== newer.id);

    const printed = restore(backup);

    expect(psql(target, 'select id from public.packs')).toBe(older.id);
    expect(psql(target, 'select pack_id from public.critters')).toBe(older.id);
    expect(psql(target, 'select distinct pack_id from public.pack_members')).toBe(older.id);
    expect(psql(target, 'select pack_id from public.feeds')).toBe(older.id);
    expect(psql(target, 'select count(*) from public.reactions')).toBe('1');
    expect(printed).toContain('public.pack_members: 2, skipped 2');
    expect(printed).toContain('public.feeds: 1, skipped 1');
    expect(printed).toContain('public.reactions: 1, skipped 1');
    expect(printed).toContain('Left out packs made after the backup began, which it holds without a critter, and their rows: ');
    expect(printed).toContain(`${newer.id} "Morning runs" (public.pack_members 2, public.feeds 1).`);
  });

  test('a pack older than the backup and held without its critter keeps its history, and the run says so', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
    const fed = await admin.from('feeds').insert({ pack_id: pack.id, user_id: noa.id, photo_path: 'noa.jpg', day: '2026-10-29' }).select('id');
    expect(fed.error).toBeNull();
    const backup = backUp([noa, dan], pack.id);
    backup.tables['public.packs']![0]!.created_at = '2026-03-01T09:00:00+00:00';
    backup.tables['public.critters'] = [];

    const printed = restore(backup);

    expect(psql(target, 'select id from public.packs')).toBe(pack.id);
    expect(psql(target, 'select count(*) from public.pack_members')).toBe('2');
    expect(psql(target, 'select id from public.feeds')).toBe(fed.data![0]!.id);
    expect(printed).toContain(`Kept packs from before the backup that it holds without a critter: ${pack.id} "Gym squad"`);
  });

  test('text that reads like the quotes of the script comes back as it was', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    const captions = ['nice run $gz$ today', 'and $restore$ again', 'a backslash \\$gz$ before it'];
    const fed = await admin
      .from('feeds')
      .insert(captions.map((caption, n) => ({ pack_id: pack.id, user_id: noa.id, photo_path: `${n}.jpg`, day: `2026-10-2${n}`, caption })));
    expect(fed.error).toBeNull();

    restore(backUp([noa], pack.id));

    expect(psql(target, 'select caption from public.feeds').split('\n').sort()).toEqual([...captions].sort());
  });

  test('a restored account looks up no time zone', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    psql('postgres', `alter database ${target} set track_functions = 'pl'`);

    restore(backUp([noa], pack.id));

    // The account's own trigger shows the count works; the lookup is behind the profile it makes.
    const ran = `select funcname, calls from pg_stat_user_functions where funcname in ('handle_new_user', 'clean_profile_settings')`;
    expect(psql(target, ran)).toBe('handle_new_user|1');
    expect(psql(target, `select count(*) from pg_trigger where tgenabled = 'D'`)).toBe('0');
  });

  test('a table goes by size: short rows share a few calls, and wide ones split', async () => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    const reported = await admin.from('app_errors').insert({ user_id: noa.id, message: 'test', platform: 'ios' });
    expect(reported.error).toBeNull();
    const backup = backUp([noa], pack.id);
    const report = backup.tables['public.app_errors']![0]!;
    const stack = 'x'.repeat(20_000);
    backup.tables['public.app_errors'] = Array.from({ length: 5000 }, (_, n) => ({ ...report, id: n + 1, stack: n < 4960 ? null : stack }));

    const printed = restore(backup);

    expect(printed).toContain('public.app_errors: 5000');
    const [, calls, largest] = /in (\d+) calls, at most (\d+) KB each/.exec(printed)!;
    // 25 calls for this table alone at 200 rows a call, and about 25 for everything else.
    expect(Number(calls)).toBeLessThan(40);
    expect(Number(largest)).toBeLessThan(260);
  });
});
