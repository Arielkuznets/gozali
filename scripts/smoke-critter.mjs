// Checks that a change to a critter in the database reaches the pack's members live, and
// only them. Run with `npx supabase start` up: node scripts/smoke-critter.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

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
  await client.from('profiles').update({ display_name: name, terms_accepted_at: new Date().toISOString() }).eq('id', created.data.user.id);
  return { client, id: created.data.user.id };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

/** Subscribes the way the app does and collects the critter rows it hears about. */
async function listen(client, packId) {
  const heard = [];
  let ready;
  const listening = new Promise((resolve) => (ready = resolve));
  const channel = client
    .channel(`smoke-${packId ?? 'mine'}-${Math.random()}`)
    // The channel joins first; the database side confirms a moment later with a system message.
    .on('system', {}, (message) => message.extension === 'postgres_changes' && message.status === 'ok' && ready())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'critters', filter: packId ? `pack_id=eq.${packId}` : undefined }, (change) =>
      heard.push(change.new),
    );
  channel.subscribe((status, error) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') throw error ?? new Error(status);
  });
  await listening;
  return { heard, stop: () => client.removeChannel(channel) };
}

const waitFor = async (condition, ms = 5000) => {
  const until = Date.now() + ms;
  while (!condition() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
  return condition();
};

const noa = await signedInUser('Noa');
const eve = await signedInUser('Eve');

const created = await noa.client.rpc('create_pack', {
  pack_name: 'Readers',
  habit: 'reading',
  rest_days: 1,
  species: 'ribbit',
  time_zone: 'Asia/Jerusalem',
});
check(!created.error, 'Noa creates a pack');
const packId = created.data;

const noaPack = await listen(noa.client, packId);
const noaAll = await listen(noa.client);
const evePack = await listen(eve.client, packId);

// The server changes the critter, as the day close will.
const update = await admin
  .from('critters')
  .update({ status: 'active', stage: 'kid', health: 45, xp: 8, outfit: { head: 'beanie' } })
  .eq('pack_id', packId);
check(!update.error, 'the server hatches the critter and makes it hungry');

// Realtime may also replay older changes to the pack, so look for this one.
const hungry = (row) => row.health === 45 && row.stage === 'kid' && row.outfit?.head === 'beanie';
check(await waitFor(() => noaPack.heard.some(hungry)), 'Noa hears the new health, stage and outfit on the pack screen');
check(await waitFor(() => noaAll.heard.some(hungry)), 'Noa hears it on the home screen too');
await new Promise((resolve) => setTimeout(resolve, 1500));
check(evePack.heard.length === 0, 'Eve, who is not in the pack, hears nothing');

await Promise.all([noaPack.stop(), noaAll.stop(), evePack.stop()]);
await admin.auth.admin.deleteUser(noa.id);
await admin.auth.admin.deleteUser(eve.id);
console.log('all good');
process.exit(0);
