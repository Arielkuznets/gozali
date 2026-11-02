import { addDays, packDayOf } from '@gozali/game-engine';
import { expect, test } from '@playwright/test';

import { closeOneDay } from '../supabase/functions/close-days/close.ts';
import { admin, createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;
let eve: TestUser;

/**
 * Moves the pack to a zone where it is 03:xx, with the members joined during the day that just
 * ended: that day is the pack's first, and it waits for its close. Returns that day.
 */
async function dayJustEnded(packId: string): Promise<string> {
  const ahead = ((3 - new Date().getUTCHours() + 36) % 24) - 12;
  const timezone = `Etc/GMT${ahead > 0 ? '-' : '+'}${Math.abs(ahead)}`;
  const moved = await admin.from('packs').update({ timezone }).eq('id', packId);
  if (moved.error) throw moved.error;
  const joined = await admin
    .from('pack_members')
    .update({ joined_at: new Date(Date.now() - 20 * 3600_000).toISOString() })
    .eq('pack_id', packId);
  if (joined.error) throw joined.error;
  return addDays(packDayOf(new Date(), timezone), -1);
}

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
  eve = await createUser('Eve');
});

test.afterEach(async () => {
  await removeUsers(noa, dan, eve);
});

test('the egg promises to hatch tonight only once nobody can stop it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan, eve]);
  // Eve has fed before and the pack has no rest days, so today she would miss without a feed or a joker.
  // Everyone joined before that feed: a member counts from feeds for the day they joined or later.
  await admin.from('packs').update({ rest_days_per_week: 0 }).eq('id', pack.id);
  await admin
    .from('pack_members')
    .update({ joined_at: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() })
    .eq('pack_id', pack.id);
  const yesterday = addDays(packDayOf(new Date(), 'Asia/Jerusalem'), -1);
  const started = await admin.from('feeds').insert({ pack_id: pack.id, user_id: eve.id, day: yesterday });
  if (started.error) throw started.error;
  const closed = await admin
    .from('day_results')
    .insert({ pack_id: pack.id, day: yesterday, result: 'neutral', applied: false, health_before: 70, health_after: 70 });
  if (closed.error) throw closed.error;
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'Leg day');
  await feed(dan, pack.id, image, 'Arms');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('Two of you fed today')).toBeVisible();
  await expect(page.getByText('It hatches tonight if no one else misses today')).toBeVisible();
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeHidden();

  // Eve can take her joker back until the day ends, and she has no rest days, so it proves nothing.
  const joker = await eve.client.rpc('use_day_pass', { target: pack.id, pass: 'joker' });
  if (joker.error) throw joker.error;
  await expect(page.getByLabel('Eve, resting today')).toBeVisible();
  await expect(page.getByText('It hatches tonight if no one else misses today')).toBeVisible();
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeHidden();

  // Once Eve fed, nobody is left who could stop it.
  await feed(eve, pack.id, image, 'Stairs');
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeVisible();
});

test('the promise comes with the second feed on a screen already open, and a new member leaves it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const image = await photo(page, '🏋️');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('Two of you feed on the same day (0/2 today)')).toBeVisible();

  await feed(noa, pack.id, image, 'Leg day');
  await feed(dan, pack.id, image, 'Arms');
  await expect(page.getByText('Two of you fed today')).toBeVisible();
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeVisible();

  const joined = await eve.client.rpc('join_pack', { code: pack.inviteCode });
  if (joined.error) throw joined.error;
  await expect(page.getByLabel('Eve, not yet today')).toBeVisible();
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeVisible();
});

test('the promise waits for the close of the day before, and then comes by itself', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const ended = await dayJustEnded(pack.id);
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'Leg day');
  await feed(dan, pack.id, image, 'Arms');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('Two of you fed today')).toBeVisible();
  await expect(page.getByText('It hatches tonight if no one else misses today')).toBeVisible();
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeHidden();

  await closeOneDay(admin, pack.id, ended);
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeVisible({ timeout: 20_000 });
});

test('an egg about to hatch keeps its steps until the close of the day that ended', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const ended = await dayJustEnded(pack.id);
  const fed = await admin.from('feeds').insert([
    { pack_id: pack.id, user_id: noa.id, day: ended },
    { pack_id: pack.id, user_id: dan.id, day: ended },
  ]);
  if (fed.error) throw fed.error;

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('How the egg hatches')).toBeVisible();
  await expect(page.getByText('(0/2 today)')).toBeHidden();
  await expect(page.getByText('Two of you fed on the same day')).toBeVisible();
  await expect(page.getByText('It hatches very soon 🎉')).toBeVisible();

  await closeOneDay(admin, pack.id, ended);
  await expect(page.getByRole('heading', { name: 'Kit hatched!' })).toBeVisible();
});
