// Six pack days closed by the real close-days code against the local stack: hatching, a joker,
// failed days, a member falling asleep, the notifications they cause, and a second run that
// changes nothing. Then everyone leaves, and the pack goes with its photo files 30 days later. Run with `npx supabase start` up: node scripts/smoke-day-close.mjs
import { createClient } from '@supabase/supabase-js';

import { addDays, closesAt, packDayOf, zonedTimeToUtc } from '../packages/game-engine/src/index.ts';
import { closeDueDays, dropEmptyPacks } from '../supabase/functions/close-days/close.ts';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
const tz = 'Asia/Jerusalem';

async function signedInUser(name) {
  const email = `${name.toLowerCase()}-${run}@gozali.test`;
  const password = `test-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, id: created.data.user.id };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const noa = await signedInUser('Noa');
const dan = await signedInUser('Dan');
const maya = await signedInUser('Maya');
const { data: packId } = await noa.client.rpc('create_pack', {
  pack_name: 'Morning runs',
  habit: 'running',
  rest_days: 0,
  species: 'kit',
  time_zone: tz,
});
const { data: pack } = await noa.client.from('packs').select('invite_code').eq('id', packId).single();
await dan.client.rpc('join_pack', { code: pack.invite_code });
await maya.client.rpc('join_pack', { code: pack.invite_code });

// Day 1 is the day the second member joined; the plan below feeds days 1 to 6.
const first = packDayOf(new Date(), tz);
const day = (n) => addDays(first, n - 1);
const feed = async (who, n, hour) => {
  const { error } = await admin.from('feeds').insert({
    pack_id: packId,
    user_id: who.id,
    day: day(n),
    created_at: new Date(zonedTimeToUtc(day(n), hour, tz)).toISOString(),
  });
  if (error) throw error;
};
await feed(noa, 1, 8);
await feed(dan, 1, 9);
await feed(noa, 2, 7);
await feed(dan, 2, 18);
await feed(maya, 2, 20);
await feed(noa, 3, 7);
await admin.from('day_passes').insert({ pack_id: packId, user_id: dan.id, day: day(3), kind: 'joker' });
await feed(noa, 5, 7);
await feed(noa, 6, 7);
await feed(dan, 6, 23);

const now = new Date(closesAt(day(6), tz).getTime() + 60_000);
const { closed, failed } = await closeDueDays(admin, now, [packId]);
check(failed.length === 0, 'the run has no failures');
check(closed.length === 6, 'six days close in one run, oldest first');
check(
  closed.map((c) => c.result.type).join(',') === 'success,success,fail,fail,fail,success',
  'day types: success, success, fail (Maya missed), fail, fail, success',
);
check(closed[0].result.events.some((e) => e.type === 'hatched'), 'day 1 hatches the egg: two members fed');
check(closed[0].result.facts.earlyBird, 'day 1 counts as an early-bird day: both fed before noon');
check(closed[2].result.outcomes.find((o) => o.userId === dan.id).outcome === 'joker', 'Dan\'s joker covers day 3');
check(closed[4].result.newlySleeping.includes(maya.id), 'Maya falls asleep after 3 misses in a week');
check(
  closed[5].result.outcomes.find((o) => o.userId === maya.id).outcome === 'sleeping' && closed[5].result.counted === 2,
  'on day 6 Maya is not counted and the day succeeds',
);

const { data: critter } = await admin.from('critters').select('*').eq('pack_id', packId).single();
check(
  critter.status === 'active' && critter.stage === 'baby' && critter.health === 52 && critter.xp === 3 && critter.streak === 1,
  `the critter ends at health 52, 3 XP, streak 1 (got ${critter.health}, ${critter.xp}, ${critter.streak})`,
);
check(critter.hatched_at !== null, 'the hatch time is saved');
const { data: members } = await admin.from('pack_members').select('user_id, status').eq('pack_id', packId);
check(members.find((m) => m.user_id === maya.id).status === 'sleeping', 'Maya\'s membership is now sleeping');

const { data: results } = await admin.from('day_results').select('day, fed_ids, joker_ids, missed_ids').eq('pack_id', packId).order('day');
check(results.length === 6 && results[2].joker_ids.includes(dan.id) && results[2].missed_ids.includes(maya.id), 'day_results keep who fed, joked and missed');
const { data: unlocked } = await admin.from('achievements').select('key').eq('pack_id', packId);
check(unlocked.map((a) => a.key).join() === 'hatched', 'the Hello world achievement is unlocked');
const { data: notes } = await admin.from('notifications').select('user_id, type, payload').eq('pack_id', packId);
check(notes.filter((n) => n.payload.event === 'hatched').length === 3, 'all three members get the hatching news');
check(notes.some((n) => n.type === 'still_in' && n.user_id === maya.id), 'Maya gets a gentle "still in?"');

const again = await closeDueDays(admin, now, [packId]);
check(again.closed.length === 0 && again.failed.length === 0, 'a second run closes nothing');

// Members see the results; outsiders get nothing through the API.
const seen = await dan.client.from('day_results').select('day').eq('pack_id', packId);
check(seen.data.length === 6, 'members can read the day results for the monthly board');
const forbidden = await dan.client.rpc('apply_day_result', { target: packId, pack_date: day(7), outcome: {} });
check(forbidden.error !== null, 'members cannot apply results themselves');

// Everyone leaves; the pack stays 30 days in case someone comes back, then goes with its photos.
const photoPath = `${packId}/${noa.id}/smoke.jpg`;
const upload = await noa.client.storage.from('feed-photos').upload(photoPath, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
  contentType: 'image/jpeg',
});
if (upload.error) throw upload.error;
await admin.from('feeds').update({ photo_path: photoPath }).eq('pack_id', packId).eq('user_id', noa.id).eq('day', day(1));
for (const user of [noa, dan, maya]) await user.client.rpc('leave_pack', { target: packId });
const removeFiles = async (paths) => {
  const { error } = await admin.storage.from('feed-photos').remove(paths);
  if (error) throw error;
};
await dropEmptyPacks(admin, removeFiles, new Date());
const kept = await admin.from('packs').select('id').eq('id', packId);
check(kept.data.length === 1, 'a pack everyone left is kept for now');
const monthAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
await admin.from('pack_members').update({ left_at: monthAgo }).eq('pack_id', packId);
await dropEmptyPacks(admin, removeFiles, new Date());
const gone = await admin.from('packs').select('id').eq('id', packId);
check(gone.data.length === 0, 'after 30 days it is deleted');
const files = await admin.storage.from('feed-photos').list(`${packId}/${noa.id}`);
check(files.data.length === 0, 'and its photo files with it');

for (const user of [noa, dan, maya]) await admin.auth.admin.deleteUser(user.id);
console.log('all good');
process.exit(0);
