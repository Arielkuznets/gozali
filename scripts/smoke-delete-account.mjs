// Account deletion against the local stack (store requirement, spec section 11): the member
// leaves every pack with admin passing on, their photo files go, their account and data go, and
// a pack only they were in is left empty (close-days deletes it 30 days later). Last, the Sign in
// with Apple revocation signs its client secret correctly and makes Apple's two calls.
// Run with `npx supabase start` and `npx supabase functions serve` up: node scripts/smoke-delete-account.mjs
import { createClient } from '@supabase/supabase-js';

import { appleClientSecret, revokeAppleSignIn } from '../supabase/functions/delete-account/apple.ts';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();
const photo = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

async function signedInUser(name) {
  const email = `${name.toLowerCase()}-${run}@gozali.test`;
  const password = `test-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { data } = await client.auth.signInWithPassword({ email, password });
  await client.from('profiles').update({ display_name: name }).eq('id', created.data.user.id);
  return { client, id: created.data.user.id, token: data.session.access_token };
}

function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

const noa = await signedInUser('Noa');
const dan = await signedInUser('Dan');
const pack = async (client, name) =>
  (await client.rpc('create_pack', { pack_name: name, habit: 'gym', rest_days: 1, species: 'mochi', time_zone: 'UTC' })).data;
const shared = await pack(noa.client, 'Gym squad');
const solo = await pack(noa.client, 'Just me');
const { data: invite } = await noa.client.from('packs').select('invite_code').eq('id', shared).single();
await dan.client.rpc('join_pack', { code: invite.invite_code });

for (const target of [shared, solo]) {
  const path = `${target}/${noa.id}/${run}.jpg`;
  await noa.client.storage.from('feed-photos').upload(path, photo, { contentType: 'image/jpeg' });
  const fed = await noa.client.rpc('submit_feed', { target, photo: path });
  if (fed.error) throw fed.error;
}

const refused = await fetch(`${url}/functions/v1/delete-account`, { method: 'POST' });
check(refused.status === 401, 'without a session nothing is deleted');

const response = await fetch(`${url}/functions/v1/delete-account`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${noa.token}`, apikey: publishableKey },
});
const body = await response.json();
check(response.ok && body.deleted && body.photos === 2, 'Noa deletes the account, with both photo files');

const { data: user } = await admin.auth.admin.getUserById(noa.id);
check(!user?.user, 'the account is gone');
const { data: files } = await admin.storage.from('feed-photos').list(`${shared}/${noa.id}`);
check(files.length === 0, 'the photo files are gone');
const { data: feeds } = await admin.from('feeds').select('id').eq('user_id', noa.id);
check(feeds.length === 0, 'and the feeds');
const { data: members } = await admin.from('pack_members').select('user_id, role').eq('pack_id', shared);
check(members.length === 1 && members[0].user_id === dan.id && members[0].role === 'admin', 'Dan is now the admin of the shared pack');
const { data: soloMembers } = await admin.from('pack_members').select('user_id').eq('pack_id', solo);
check(soloMembers.length === 0, 'the pack only Noa was in is left empty');

await admin.from('packs').delete().in('id', [shared, solo]);
await admin.auth.admin.deleteUser(dan.id);

// Sign in with Apple revocation, with a throwaway key and a stand-in for Apple.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const key = {
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
  privateKey: ['-----BEGIN PRIVATE KEY-----', ...pkcs8.match(/.{1,64}/g), '-----END PRIVATE KEY-----'].join('\n'),
  clientId: 'app.gozali',
};
const secret = await appleClientSecret(key);
const [header, payload, signature] = secret.split('.');
const verified = await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' },
  pair.publicKey,
  Buffer.from(signature, 'base64url'),
  new TextEncoder().encode(`${header}.${payload}`),
);
const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
check(verified && claims.iss === 'TEAM123456' && claims.sub === 'app.gozali' && claims.aud === 'https://appleid.apple.com', 'the Apple client secret is signed with the key and names the app');
const calls = [];
const revoked = await revokeAppleSignIn(key, 'code-123', async (url, init) => {
  calls.push({ url, body: new URLSearchParams(init.body) });
  return new Response(JSON.stringify(url.endsWith('/auth/token') ? { refresh_token: 'refresh-456' } : {}), { status: 200 });
});
check(
  revoked === 'revoked' &&
    calls[0].url.endsWith('/auth/token') && calls[0].body.get('code') === 'code-123' &&
    calls[1].url.endsWith('/auth/revoke') && calls[1].body.get('token') === 'refresh-456',
  'deleting revokes Sign in with Apple: the code becomes a token, and the token is revoked',
);
console.log('all good');
process.exit(0);
