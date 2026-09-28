// The widget endpoint against the local stack: a device token reads the packs' numbers and
// critter image, shows no names or photos, and stops working once revoked.
// Run with `npx supabase start` and `npx supabase functions serve` up: node scripts/smoke-widgets.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
const endpoint = `${url}/functions/v1/widget-state`;

async function signedInUser(name) {
  const email = `${name.toLowerCase()}-${run}@gozali.test`;
  const password = `test-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  await client.auth.signInWithPassword({ email, password });
  await client.from('profiles').update({ display_name: name, timezone: 'Asia/Jerusalem' }).eq('id', created.data.user.id);
  return { client, id: created.data.user.id };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const noa = await signedInUser('Noa');
const dan = await signedInUser('Dan');
const { data: packId } = await noa.client.rpc('create_pack', {
  pack_name: 'Gym squad',
  habit: 'gym',
  rest_days: 2,
  species: 'kit',
  time_zone: 'Asia/Jerusalem',
});
const { data: pack } = await noa.client.from('packs').select('invite_code').eq('id', packId).single();
await dan.client.rpc('join_pack', { code: pack.invite_code });
await admin.from('critters').update({ status: 'active', stage: 'kid', health: 55, streak: 4, name: 'Pixel' }).eq('pack_id', packId);
await admin.from('feeds').insert({ pack_id: packId, user_id: dan.id, day: (await noa.client.rpc('my_day_status', { target: packId })).data.day });

const { data: token } = await noa.client.rpc('create_widget_token');
check(typeof token === 'string' && token.length === 64, 'the app gets a widget token for this device');
const { data: stored } = await admin.from('widget_tokens').select('token_hash').eq('user_id', noa.id);
check(stored.length === 1 && stored[0].token_hash !== token, 'the server keeps only a hash of it');

check((await fetch(endpoint)).status === 401, 'no token, no state');
check((await fetch(endpoint, { headers: { 'x-widget-token': 'nope' } })).status === 401, 'an unknown token gets nothing');

const response = await fetch(endpoint, { headers: { 'x-widget-token': token } });
const state = await response.json();
const mine = state.packs.find((p) => p.id === packId);
check(response.ok && mine !== undefined, 'the token reads the owner\'s packs');
check(mine.critterName === 'Pixel' && mine.health === 55 && mine.fed === 1 && mine.total === 2 && !mine.iFed, 'with the critter and "1/2", and Noa not fed yet');
check(mine.label === 'Pixel is hungry, health 55', 'and a screen reader description');
const text = JSON.stringify(state);
check(!text.includes('Dan') && !text.includes('Noa') && !text.includes('photo'), 'no member names or photos anywhere');

const image = await fetch(new URL(mine.imageUrl, endpoint), { headers: { 'x-widget-token': token } });
const bytes = new Uint8Array(await image.arrayBuffer());
check(image.headers.get('content-type') === 'image/png' && bytes[1] === 0x50 && bytes[2] === 0x4e, 'the critter comes as a PNG');
check(mine.nightImageUrl !== mine.imageUrl, 'with a separate night picture');

const strangerToken = (await dan.client.rpc('create_widget_token')).data;
const other = await fetch(`${endpoint}?image=${packId}`, { headers: { 'x-widget-token': strangerToken } });
check(other.status === 200, 'Dan, a member, can load the pack picture with their own token');

await noa.client.rpc('revoke_widget_token', { token });
check((await fetch(endpoint, { headers: { 'x-widget-token': token } })).status === 401, 'a revoked token stops working');

await admin.from('packs').delete().eq('id', packId);
for (const user of [noa, dan]) await admin.auth.admin.deleteUser(user.id);
console.log('all good');
process.exit(0);
