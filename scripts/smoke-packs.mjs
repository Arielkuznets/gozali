// End-to-end smoke test of the pack flow against the local Supabase stack, using the same
// calls as the app: two users create, preview, join, change settings and leave a pack.
// Run with `npx supabase start` up: node scripts/smoke-packs.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

const PACK_FIELDS = `
  id, name, category, custom_habit, rest_days_per_week, week_start, invite_code,
  pending_rest_days_per_week, pending_week_start, pending_from,
  critters ( species, color, name, health, stage, status, streak ),
  pack_members ( user_id, role, status, joined_at, profiles ( display_name ) )
`;

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();

async function signedInUser(name) {
  const email = `${name.toLowerCase()}-${run}@gozali.test`;
  const password = `test-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const profile = await client
    .from('profiles')
    .update({ display_name: name, terms_accepted_at: new Date().toISOString() })
    .eq('id', created.data.user.id);
  if (profile.error) throw profile.error;
  return { client, id: created.data.user.id };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const noa = await signedInUser('Noa');
const dan = await signedInUser('Dan');

const created = await noa.client.rpc('create_pack', {
  pack_name: 'Gym squad',
  habit: 'gym',
  rest_days: 3,
  species: 'spark',
  critter_color: 'sky',
  time_zone: 'Asia/Jerusalem',
});
check(!created.error && typeof created.data === 'string', 'Noa creates a pack');
const packId = created.data;

const mine = await noa.client.from('packs').select(PACK_FIELDS);
check(!mine.error && mine.data.length === 1, "Noa's pack list has the new pack");
const pack = mine.data[0];
check(pack.critters?.status === 'egg' && pack.critters.species === 'spark', 'the critter is a spark egg (one-to-one relation)');
check(pack.pack_members[0]?.profiles?.display_name === 'Noa', 'member names come through the profiles relation');

const preview = await dan.client.rpc('pack_preview', { code: pack.invite_code.toLowerCase() });
check(!preview.error && preview.data[0]?.member_count === 1, 'Dan previews the pack with a lower-case code');
check(
  preview.data[0].critter.species === 'spark' && preview.data[0].member_names.join() === 'Noa',
  'the preview shows the critter and who is in the pack',
);

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

await admin.auth.admin.deleteUser(noa.id);
await admin.auth.admin.deleteUser(dan.id);
console.log('all good');
