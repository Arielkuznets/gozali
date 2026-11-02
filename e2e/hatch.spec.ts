import { addDays, packDayOf } from '@gozali/game-engine';
import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;
let eve: TestUser;

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
  const started = await admin
    .from('feeds')
    .insert({ pack_id: pack.id, user_id: eve.id, day: addDays(packDayOf(new Date(), 'Asia/Jerusalem'), -1) });
  if (started.error) throw started.error;
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
