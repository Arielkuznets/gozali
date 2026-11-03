// End-to-end smoke test of the pack flow against the local Supabase stack, using the same
// calls as the app: two users create, preview, join, change settings and leave a pack. What only
// goes wrong at the same moment runs beside a second connection, held open in a transaction.
// Run with `npx supabase start` up: node scripts/smoke-packs.mjs
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

const PACK_FIELDS = `
  id, name, category, custom_habit, rest_days_per_week, week_start, timezone, invite_code,
  pending_rest_days_per_week, pending_week_start, pending_from,
  critters ( species, name, health, xp, stage, status, streak, coins, marks, outfit ),
  pack_members ( user_id, role, status, joined_at, profiles ( display_name, avatar_path ) )
`;

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
const users = [];
const packs = [];

async function signedInUser(name) {
  const email = `${name.toLowerCase()}-${run}-${users.length}@gozali.test`;
  const password = `test-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  users.push(created.data.user.id);
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const profile = await client
    .from('profiles')
    .update({ display_name: name, terms_accepted_at: new Date().toISOString() })
    .eq('id', created.data.user.id);
  if (profile.error) throw profile.error;
  return { client, id: created.data.user.id, token: signIn.data.session.access_token };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

/**
 * A connection of its own, for what the API can't do: stay inside a transaction while a call runs
 * beside it. `run` sends SQL and gives back what psql printed. `close` ends the connection, which
 * rolls back anything still open.
 */
function openSession() {
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
async function whileOpen(held, call) {
  const session = openSession();
  try {
    await session.run(`begin; ${held}`);
    let finished = false;
    const answer = Promise.resolve(call()).finally(() => (finished = true));
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
function as(person, sql) {
  const claims = JSON.stringify({ sub: person.id, role: 'authenticated' });
  return `set local role authenticated; select set_config('request.jwt.claims', '${claims}', true); ${sql}; reset role;`;
}

function createPack(person) {
  return person.client.rpc('create_pack', {
    pack_name: 'Together',
    habit: 'gym',
    rest_days: 1,
    species: 'kit',
    time_zone: 'Asia/Jerusalem',
  });
}

/** A pack with this many members who joined one after another, the first its admin. */
async function packOf(size) {
  const people = [];
  for (let n = 1; n <= size; n++) people.push(await signedInUser(`Member${n}`));
  const made = await createPack(people[0]);
  if (made.error) throw made.error;
  packs.push(made.data);
  const { data } = await people[0].client.from('packs').select('invite_code').eq('id', made.data).single();
  for (const person of people.slice(1)) {
    const joined = await person.client.rpc('join_pack', { code: data.invite_code });
    if (joined.error) throw joined.error;
  }
  return { pack: made.data, code: data.invite_code, people };
}

/** That person is the pack's one admin, and hasn't left. */
async function isOnlyAdmin(pack, person) {
  const { data } = await admin.from('pack_members').select('user_id, status').eq('pack_id', pack).eq('role', 'admin');
  return data.length === 1 && data[0].user_id === person.id && data[0].status !== 'left';
}

async function packCount(person) {
  const { count } = await admin
    .from('pack_members')
    .select('pack_id', { count: 'exact', head: true })
    .eq('user_id', person.id)
    .neq('status', 'left');
  return count;
}

try {
  const noa = await signedInUser('Noa');
  const dan = await signedInUser('Dan');

  const created = await noa.client.rpc('create_pack', {
    pack_name: 'Gym squad',
    habit: 'gym',
    rest_days: 3,
    species: 'kit',
    time_zone: 'Asia/Jerusalem',
  });
  check(!created.error && typeof created.data === 'string', 'Noa creates a pack');
  const packId = created.data;
  packs.push(packId);

  const mine = await noa.client.from('packs').select(PACK_FIELDS);
  check(!mine.error && mine.data.length === 1, "Noa's pack list has the new pack");
  const pack = mine.data[0];
  check(pack.critters?.status === 'egg' && pack.critters.species === 'kit', 'the critter is a Kit egg (one-to-one relation)');
  check(pack.pack_members[0]?.profiles?.display_name === 'Noa', 'member names come through the profiles relation');

  const preview = await dan.client.rpc('pack_preview', { code: pack.invite_code.toLowerCase() });
  check(!preview.error && preview.data[0]?.member_count === 1, 'Dan previews the pack with a lower-case code');
  check(
    preview.data[0].critter.species === 'kit' && preview.data[0].member_names.join() === 'Noa',
    'the preview shows the critter and who is in the pack',
  );

  // A GET or HEAD runs in a read-only transaction, where a wrong code can't be counted as a miss.
  const headers = { apikey: publishableKey, Authorization: `Bearer ${dan.token}` };
  for (const method of ['GET', 'HEAD']) {
    const answer = await fetch(`${url}/rest/v1/rpc/pack_preview?code=${pack.invite_code}`, { method, headers });
    check(answer.status === 405, `a ${method} gets no preview, even with the right code`);
  }

  const joined = await dan.client.rpc('join_pack', { code: pack.invite_code });
  check(joined.data === packId, 'Dan joins the pack');

  const seen = await dan.client.from('packs').select(PACK_FIELDS).eq('id', packId).single();
  const names = seen.data.pack_members.map((member) => member.profiles?.display_name).sort();
  check(names.join(',') === 'Dan,Noa', 'Dan sees both members with their names');

  const denied = await dan.client.rpc('update_pack', { target: packId, pack_name: 'Mine', rest_days: 1, starts_on: 'monday' });
  check(denied.error?.message.includes('admin_only'), 'Dan cannot change the settings');

  const updated = await noa.client.rpc('update_pack', { target: packId, pack_name: 'Gym gang', rest_days: 2, starts_on: 'sunday' });
  check(!updated.error, 'Noa changes the settings');
  const after = await noa.client.from('packs').select(PACK_FIELDS).eq('id', packId).single();
  check(after.data.name === 'Gym gang' && after.data.pending_rest_days_per_week === 2, 'the name changes now and rest days are pending');

  const left = await noa.client.rpc('leave_pack', { target: packId });
  check(!left.error, 'Noa leaves');
  const danView = await dan.client.from('packs').select(PACK_FIELDS).eq('id', packId).single();
  const danMember = danView.data.pack_members.find((member) => member.user_id === dan.id);
  check(danMember?.role === 'admin', 'Dan becomes the admin');
  const noaView = await noa.client.from('packs').select('id');
  check(noaView.data.length === 0, 'the pack disappears from Noa\'s list');

  const sam = await signedInUser('Sam');
  const rob = await signedInUser('Rob');
  const eve = await signedInUser('Eve');
  await sam.client.rpc('join_pack', { code: pack.invite_code });
  await rob.client.rpc('join_pack', { code: pack.invite_code });
  const asleep = await admin.from('pack_members').update({ status: 'sleeping' }).eq('pack_id', packId).eq('user_id', sam.id);
  check(!asleep.error, 'Sam falls asleep');
  const removed = await dan.client.rpc('remove_member', { target: packId, member: rob.id });
  check(!removed.error, 'Dan removes Rob');

  for (const [person, sees, who] of [
    [dan, true, 'a member'],
    [sam, true, 'a sleeping member'],
    [noa, false, 'someone who left'],
    [rob, false, 'someone the admin removed'],
    [eve, false, 'someone who never joined'],
  ]) {
    const list = await person.client.from('packs').select(PACK_FIELDS).order('created_at');
    const one = await person.client.from('packs').select(PACK_FIELDS).eq('id', packId).maybeSingle();
    check(!list.error && list.data.length === (sees ? 1 : 0), `${who} ${sees ? 'sees' : 'does not see'} the pack in the list`);
    check(!one.error && (one.data?.id === packId) === sees, `${who} ${sees ? 'gets' : 'does not get'} the pack by its id`);
  }

  // The admin's account goes from the dashboard just as the next in line leaves.
  {
    const { pack: target, people: [first, second, third] } = await packOf(3);
    const out = await whileOpen(`delete from auth.users where id = '${first.id}';`, () =>
      second.client.rpc('leave_pack', { target }),
    );
    check(!out.error && (await isOnlyAdmin(target, third)), 'the role goes on past a next in line who leaves as the admin is deleted');
  }

  // The next in line is halfway through leaving when the admin's account goes.
  {
    const { pack: target, people: [first, second, third] } = await packOf(3);
    const gone = await whileOpen(as(second, `select public.leave_pack('${target}')`), () =>
      admin.auth.admin.deleteUser(first.id),
    );
    check(!gone.error && (await isOnlyAdmin(target, third)), 'the role skips a member halfway out when the admin is deleted');
  }

  // The admin taps Leave on one phone and removes the next in line on another.
  {
    const { pack: target, people: [first, second] } = await packOf(3);
    const removal = await whileOpen(as(first, `select public.leave_pack('${target}')`), () =>
      first.client.rpc('remove_member', { target, member: second.id }),
    );
    check(removal.error?.message.includes('admin_only'), 'an admin who has just left can no longer remove anyone');
    check(await isOnlyAdmin(target, second), 'so the next in line keeps the role');
  }

  // Someone comes back just as the last member's account goes.
  {
    const { pack: target, code, people: [first, second] } = await packOf(2);
    await second.client.rpc('leave_pack', { target });
    const back = await whileOpen(`delete from auth.users where id = '${first.id}';`, () =>
      second.client.rpc('join_pack', { code }),
    );
    check(back.data === target && (await isOnlyAdmin(target, second)), 'someone back as the last member is deleted becomes the admin');
  }

  // The next in line's account goes from the dashboard just as the admin leaves.
  {
    const { pack: target, people: [first, second, third] } = await packOf(3);
    const out = await whileOpen(`delete from auth.users where id = '${second.id}';`, () =>
      first.client.rpc('leave_pack', { target }),
    );
    check(!out.error && (await isOnlyAdmin(target, third)), 'the role goes past a next in line deleted as the admin leaves');
  }

  // Two accounts go from the dashboard at once, the admin's and the next in line's.
  {
    const { pack: target, people: [first, second, third] } = await packOf(3);
    const gone = await whileOpen(`delete from auth.users where id = '${second.id}';`, () =>
      admin.auth.admin.deleteUser(first.id),
    );
    check(!gone.error && (await isOnlyAdmin(target, third)), 'the role goes past a next in line deleted with the admin');
  }

  // One account at the same moment, from hand-made calls or two phones.
  {
    const solo = await signedInUser('Solo');
    const made = await Promise.all(Array.from({ length: 6 }, () => createPack(solo)));
    packs.push(...made.flatMap((one) => one.data ?? []));
    check((await packCount(solo)) === 3, 'six packs created at once stop at the limit of three');
    check(made.filter((one) => one.error?.message.includes('pack_limit_reached')).length === 3, 'and the other three hear why');
  }

  {
    const joiner = await signedInUser('Joiner');
    const hosts = [];
    for (let n = 0; n < 5; n++) hosts.push(await packOf(1));
    const [made] = await Promise.all([
      createPack(joiner),
      ...hosts.map(({ code }) => joiner.client.rpc('join_pack', { code })),
    ]);
    if (made.data) packs.push(made.data);
    check((await packCount(joiner)) === 3, 'five joins and a new pack at once stop there too');
  }

  // Each person waits only for their own calls, so a pack still fills up at once.
  {
    const { pack: target, code } = await packOf(1);
    const friends = [];
    for (let n = 0; n < 6; n++) friends.push(await signedInUser('Friend'));
    const joins = await Promise.all(friends.map((friend) => friend.client.rpc('join_pack', { code })));
    check(joins.every((join) => join.data === target), 'six people joining one pack at once all get in');
  }

  console.log('all good');
} finally {
  // Whatever got made goes, even from a run that stopped halfway.
  if (packs.length > 0) await admin.from('packs').delete().in('id', packs);
  for (const id of users) await admin.auth.admin.deleteUser(id);
}
