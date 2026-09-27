// Feeding end to end against the local stack, with the same calls as the app: Noa uploads a
// photo and feeds, Dan sees it live and can open the photo, Eve (not in the pack) can't.
// Run with `npx supabase start` up: node scripts/smoke-feeds.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
// A 1x1 JPEG.
const photo = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

async function signedInUser(name) {
  const email = `${name.toLowerCase()}-${run}@gozali.test`;
  const password = `test-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  await client.from('profiles').update({ display_name: name, terms_accepted_at: new Date().toISOString() }).eq('id', created.data.user.id);
  return { client, id: created.data.user.id };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const noa = await signedInUser('Noa');
const dan = await signedInUser('Dan');
const eve = await signedInUser('Eve');

const created = await noa.client.rpc('create_pack', {
  pack_name: 'Study buddies',
  habit: 'study',
  rest_days: 1,
  species: 'blob',
  critter_color: 'butter',
  time_zone: 'Asia/Jerusalem',
});
const packId = created.data;
const { data: pack } = await noa.client.from('packs').select('invite_code').eq('id', packId).single();
check((await dan.client.rpc('join_pack', { code: pack.invite_code })).data === packId, 'Dan joins Noa\'s pack');

// Dan listens for feeds the way the pack screen does.
const heard = [];
let ready;
const listening = new Promise((resolve) => (ready = resolve));
const channel = dan.client
  .channel(`smoke-feeds-${run}`)
  .on('system', {}, (message) => message.extension === 'postgres_changes' && message.status === 'ok' && ready())
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feeds', filter: `pack_id=eq.${packId}` }, (change) =>
    heard.push(change.new),
  )
  .subscribe();
await listening;

const path = `${packId}/${noa.id}/${run}.jpg`;
const upload = await noa.client.storage.from('feed-photos').upload(path, photo, { contentType: 'image/jpeg' });
check(!upload.error, 'Noa uploads the photo into their own folder');
const again = await noa.client.storage.from('feed-photos').upload(path, photo, { contentType: 'image/jpeg' });
check(String(again.error?.statusCode) === '409', 'uploading the same path again is a conflict (the retry case)');
const foreign = await noa.client.storage.from('feed-photos').upload(`${packId}/${dan.id}/x.jpg`, photo, { contentType: 'image/jpeg' });
check(foreign.error !== null, 'Noa cannot upload into Dan\'s folder');

const fed = await noa.client.rpc('submit_feed', {
  target: packId,
  photo: path,
  note: 'Two chapters',
  taken_at: new Date().toISOString(),
  focus: 45,
});
check(!fed.error && typeof fed.data === 'string', 'Noa feeds with a caption and a 45 minute focus session');
const twice = await noa.client.rpc('submit_feed', { target: packId, photo: path });
check(twice.error?.message.includes('already_fed'), 'a second counted feed the same day is refused');

const until = Date.now() + 5000;
while (heard.length === 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
check(heard[0]?.user_id === noa.id && heard[0]?.focus_minutes === 45, 'Dan hears the feed live');

const danFeeds = await dan.client.from('feeds').select('photo_path, caption, is_extra').eq('pack_id', packId);
check(danFeeds.data?.[0]?.caption === 'Two chapters', 'Dan sees the feed in the pack feed');
const link = await dan.client.storage.from('feed-photos').createSignedUrl(path, 60);
check(!link.error, 'Dan gets a signed link to the photo');
const download = await fetch(link.data.signedUrl);
check(download.ok && (await download.arrayBuffer()).byteLength === photo.length, 'the link serves the photo');

const eveLink = await eve.client.storage.from('feed-photos').createSignedUrl(path, 60);
check(eveLink.error !== null, 'Eve, who is not in the pack, gets no link');
const eveFeeds = await eve.client.from('feeds').select('id').eq('pack_id', packId);
check(eveFeeds.data?.length === 0, 'and sees no feeds');

await dan.client.removeChannel(channel);
await admin.storage.from('feed-photos').remove([path]);
for (const user of [noa, dan, eve]) await admin.auth.admin.deleteUser(user.id);
console.log('all good');
process.exit(0);
