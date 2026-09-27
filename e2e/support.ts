// Test data for the end-to-end tests, made through the local Supabase API like the smoke scripts.
import type { Page } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!publishableKey || !secretKey) {
  throw new Error('Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npx supabase status`).');
}

export const admin = createClient(url, secretKey, { auth: { persistSession: false } });
const run = Date.now();

export type TestUser = { id: string; name: string; client: SupabaseClient; session: Session };

/** A signed-in user who finished the profile setup. */
export async function createUser(name: string): Promise<TestUser> {
  const email = `${name.toLowerCase()}-e2e-${run}-${Math.random().toString(36).slice(2, 8)}@gozali.test`;
  const password = `e2e-${run}-${name}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey!, { auth: { persistSession: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const profile = await client
    .from('profiles')
    .update({ display_name: name, terms_accepted_at: new Date().toISOString() })
    .eq('id', created.data.user.id);
  if (profile.error) throw profile.error;
  return { id: created.data.user.id, name, client, session: signedIn.data.session };
}

/** Deletes the users and every pack they were in. */
export async function removeUsers(...users: TestUser[]): Promise<void> {
  const ids = users.map((user) => user.id);
  const { data: memberships } = await admin.from('pack_members').select('pack_id').in('user_id', ids);
  const packs = [...new Set((memberships ?? []).map((row) => row.pack_id as string))];
  if (packs.length > 0) await admin.from('packs').delete().in('id', packs);
  for (const id of ids) await admin.auth.admin.deleteUser(id);
}

/** Opens the app signed in as the user: the session goes where supabase-js keeps it on the web. */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.addInitScript((session) => {
    window.localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
  }, user.session);
}

type NewPack = { name: string; habit: 'gym' | 'study' | 'reading' | 'running' | 'water'; species: 'blob' | 'spark' | 'mossy' };

/** A pack made by `owner`, with the others joined. Returns its id and invite code. */
export async function createPack(owner: TestUser, pack: NewPack, others: TestUser[] = []) {
  const created = await owner.client.rpc('create_pack', {
    pack_name: pack.name,
    habit: pack.habit,
    rest_days: 1,
    species: pack.species,
    critter_color: 'peach',
    time_zone: 'Asia/Jerusalem',
  });
  if (created.error) throw created.error;
  const id = created.data as string;
  const { data } = await owner.client.from('packs').select('invite_code').eq('id', id).single();
  for (const member of others) {
    const joined = await member.client.rpc('join_pack', { code: data!.invite_code });
    if (joined.error) throw joined.error;
  }
  return { id, inviteCode: data!.invite_code as string };
}

/**
 * A JPEG to stand in for a photo: an emoji on a gradient, drawn on the test's own page before it
 * opens the app. A second window would push the test page to the background, where Chromium
 * stops painting camera frames.
 */
export async function photo(page: Page, emoji: string): Promise<Buffer> {
  await page.setContent(
    `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;` +
      `background:linear-gradient(160deg,#BCD9E8,#5B8DB8);font:140px system-ui">${emoji}</body>`,
  );
  return await page.screenshot({ type: 'jpeg', quality: 80 });
}

/** Posts a feed for `member` the way the app does: upload, then submit_feed. */
export async function feed(member: TestUser, packId: string, image: Buffer, caption: string): Promise<void> {
  const path = `${packId}/${member.id}/${Date.now()}.jpg`;
  const upload = await member.client.storage.from('feed-photos').upload(path, image, { contentType: 'image/jpeg' });
  if (upload.error) throw upload.error;
  const submitted = await member.client.rpc('submit_feed', { target: packId, photo: path, note: caption });
  if (submitted.error) throw submitted.error;
}
