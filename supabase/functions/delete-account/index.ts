// Deletes the caller's account and everything in it (spec section 11: a store requirement), and
// revokes their Sign in with Apple when the app sent a code for it (apple.ts). Needs the service
// role, so it runs on the server. The caller is identified by their session.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { appleKeyFrom, revokeAppleSignIn } from './apple.ts';

const REMOVE_BATCH = 100;

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
  } = await asUser.auth.getUser();
  if (!user) return new Response('not signed in', { status: 401 });

  // Sign in with Apple is revoked when the app sent a fresh code and the Apple key is set up. It
  // never stops the deletion.
  const { appleAuthorizationCode } = (await request.json().catch(() => ({}))) as { appleAuthorizationCode?: string };
  const appleKey = appleKeyFrom((name) => Deno.env.get(name));
  if (appleAuthorizationCode && appleKey) {
    const revoked = await revokeAppleSignIn(appleKey, appleAuthorizationCode).catch((error) => String(error));
    if (revoked !== 'revoked') console.error('apple revocation', revoked);
  }
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  // Leave every pack as the member, so the admin role passes to the longest-standing member.
  const { data: memberships, error: listError } = await asUser
    .from('pack_members')
    .select('pack_id')
    .eq('user_id', user.id)
    .neq('status', 'left');
  if (listError) return Response.json({ error: listError.message }, { status: 500 });
  for (const membership of memberships) {
    const { error } = await asUser.rpc('leave_pack', { target: membership.pack_id });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  // Photo files, including those a weekly recap points to.
  const { data: paths, error: pathError } = await admin.rpc('account_photo_paths', { member: user.id });
  if (pathError) return Response.json({ error: pathError.message }, { status: 500 });
  const files = paths as string[];
  for (let start = 0; start < files.length; start += REMOVE_BATCH) {
    const { error } = await admin.storage.from('feed-photos').remove(files.slice(start, start + REMOVE_BATCH));
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  // The profile photos.
  const { data: avatars } = await admin.storage.from('avatars').list(user.id);
  if (avatars && avatars.length > 0) {
    await admin.storage.from('avatars').remove(avatars.map((file) => `${user.id}/${file.name}`));
  }

  // The rest goes with the auth user: profile, memberships, feeds, reactions, passes, tokens.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 });

  return Response.json({ deleted: true, photos: files.length });
});
