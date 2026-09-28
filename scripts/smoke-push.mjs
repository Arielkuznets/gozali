// Notifications end to end against the local stack, with a stand-in for Expo Push: feeds queue
// merged "friend fed" and "last one" notifications, claim_notifications releases them, the
// send-push code renders the critter's lines, dead tokens and failed batches are handled, and
// the owner hears about a new sign-up.
// Run with `npx supabase start` up: node scripts/smoke-push.mjs
import { createClient } from '@supabase/supabase-js';

import { addDays, packDayOf, wallClock, zonedTimeToUtc } from '../packages/game-engine/src/index.ts';
import { render } from '../supabase/functions/send-push/messages.ts';
import { sendAll } from '../supabase/functions/send-push/push.ts';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!secretKey) throw new Error('Set SUPABASE_SECRET_KEY (see `npx supabase status`).');

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
const tz = 'Asia/Jerusalem';

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

async function user(name) {
  const created = await admin.auth.admin.createUser({ email: `${name.toLowerCase()}-${run}@gozali.test`, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  await admin.from('profiles').update({ display_name: name, timezone: tz }).eq('id', id);
  await admin.from('push_tokens').insert({ token: `ExponentPushToken[${name}-${run}]`, user_id: id, platform: 'ios' });
  return id;
}

const noa = await user('Noa');
const dan = await user('Dan');
const maya = await user('Maya');
const { data: pack } = await admin
  .from('packs')
  .insert({ name: 'Runners', category: 'running', rest_days_per_week: 0, timezone: tz, invite_code: `R${String(run).slice(-7)}`.replace(/[01IO]/g, '2') })
  .select('id')
  .single();
await admin.from('critters').insert({ pack_id: pack.id, species: 'kit', status: 'active', stage: 'kid', name: 'Pixel' });
const joined = await admin.from('pack_members').insert([
  { pack_id: pack.id, user_id: noa, role: 'admin' },
  { pack_id: pack.id, user_id: dan, role: 'member' },
  { pack_id: pack.id, user_id: maya, role: 'member' },
]);
if (joined.error) throw joined.error;

const today = packDayOf(new Date(), tz);
// Everyone fed yesterday, so everyone has started; the notifications that causes don't matter here.
await admin.from('feeds').insert([noa, dan, maya].map((id) => ({ pack_id: pack.id, user_id: id, day: addDays(today, -1) })));
await admin.from('notifications').delete().eq('pack_id', pack.id);

for (const member of [dan, maya]) {
  const fed = await admin.from('feeds').insert({ pack_id: pack.id, user_id: member, day: today });
  if (fed.error) throw fed.error;
}

const { data: queued } = await admin.from('notifications').select('user_id, type, payload').eq('pack_id', pack.id);
check(queued.filter((n) => n.type === 'friend_fed').length === 3, 'two feeds make three friend-fed notifications, merged per member');
check(queued.some((n) => n.type === 'last_one' && n.user_id === noa), 'Noa, the only one left, gets "last one"');

// Claim after the 10-minute merge window, at a daytime hour for the members.
let at = new Date(Date.now() + 11 * 60_000);
const hour = wallClock(at, tz).hour;
if (hour >= 23 || hour < 7) at = zonedTimeToUtc(addDays(packDayOf(at, tz), 1), 12, tz);
const { data: claimed, error } = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
if (error) throw error;
const mine = claimed.filter((row) => row.pack_id === pack.id);
check(mine.length === 4, 'all four are due and claimed');

const sentMessages = [];
const result = await sendAll(mine, async (batch) => {
  sentMessages.push(...batch);
  return batch.map((message) =>
    message.to.includes('Maya') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' },
  );
});
const bodyFor = (id, text) => sentMessages.some((m) => m.to.includes(id) && m.body === text);
check(bodyFor('Noa', '2 friends fed Pixel 🍽️'), 'Noa reads "2 friends fed Pixel"');
check(bodyFor('Dan', 'Maya fed Pixel 🍽️'), 'Dan reads "Maya fed Pixel"');
check(bodyFor('Noa', 'Everyone fed me. Everyone. Except. You. 👀'), 'the "last one" line is in Kit\'s voice');
check(sentMessages.find((m) => m.body.startsWith('Everyone fed me'))?.data.url === `/pack/${pack.id}/feed`, '"last one" opens the camera');
check(result.sent === 3 && result.deadTokens.length === 1, "Maya's dead token is reported");
await admin.rpc('forget_push_tokens', { dead: result.deadTokens });
const { data: mayaTokens } = await admin.from('push_tokens').select('token').eq('user_id', maya);
check(mayaTokens.length === 0, 'and forgotten');

// A batch the push service rejects goes back to the queue.
await admin.from('notifications').insert({ user_id: noa, pack_id: pack.id, type: 'evolution', payload: { event: 'evolved', to: 'teen' } });
const again = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
const failed = await sendAll(again.data.filter((row) => row.pack_id === pack.id), async () => {
  throw new Error('push service down');
});
await admin.rpc('requeue_notifications', { ids: failed.requeue });
const { data: evolution } = await admin.from('notifications').select('status').eq('pack_id', pack.id).eq('type', 'evolution').single();
check(evolution.status === 'pending', 'a failed batch is pending again for the next run');

// Owner alerts: someone finishing the profile setup tells the owner, in plain words.
const owned = await admin.from('app_owners').insert({ user_id: noa });
if (owned.error) throw owned.error;
const lior = await user('Lior');
await admin.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', lior);
const alerts = await admin.rpc('claim_notifications', { at_time: at.toISOString() });
if (alerts.error) throw alerts.error;
const alertMessages = [];
await sendAll(
  alerts.data.filter((row) => row.type === 'new_user' && row.user_id === noa),
  async (batch) => {
    alertMessages.push(...batch);
    return batch.map(() => ({ status: 'ok' }));
  },
);
check(alertMessages.length === 1 && /^🐣 Lior joined Gozali, user number \d+$/.test(alertMessages[0].body), 'the owner reads "Lior joined Gozali"');
const summary = render({ type: 'daily_summary', payload: { newUsers: 2, users: 41, feeders: 1, packs: 1, reports: 1, errors: 0 } });
check(summary.body === '👋 2 new (41 in all) · 🍽️ 1 person fed 1 pack · 🚩 1 report', 'the daily summary fits in one line');
const trouble = render({ type: 'daily_summary', payload: { newUsers: 0, users: 41, feeders: 0, packs: 0, serverErrors: 3, downHours: 2 } });
check(trouble.body.endsWith('· 🛠️ 3 server errors · 📴 down 2h'), 'and says when the server had trouble');

await admin.from('packs').delete().eq('id', pack.id);
for (const id of [noa, dan, maya, lior]) await admin.auth.admin.deleteUser(id);
console.log('all good');
process.exit(0);
