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
  await admin.from('packs').update({ rest_days_per_week: 0 }).eq('id', pack.id);
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

  // With a joker Eve can't miss today, so nothing can stop the hatch any more.
  const joker = await eve.client.rpc('use_day_pass', { target: pack.id, pass: 'joker' });
  if (joker.error) throw joker.error;
  await expect(page.getByText('It hatches tonight, when today ends 🎉')).toBeVisible();
});
