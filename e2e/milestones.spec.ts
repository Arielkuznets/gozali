import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, removeUsers, signIn, swipeUp, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
});

test.afterEach(async () => {
  await removeUsers(noa, dan);
});

test('hatching and growing up are celebrated once each', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const feed = page.getByRole('button', { name: 'Feed', exact: true });
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(feed).toBeVisible();
  // The phone has now seen the egg.
  await page.waitForTimeout(500);

  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 1, health: 80 }).eq('pack_id', pack.id);
  await page.reload();
  const hatched = page.getByRole('heading', { name: 'Kit hatched!' });
  await expect(hatched).toBeVisible();
  await page.getByRole('button', { name: 'Yay!' }).click();
  await expect(hatched).toBeHidden();

  await page.reload();
  await expect(feed).toBeVisible();
  await expect(hatched).toBeHidden();

  await admin.from('critters').update({ stage: 'kid', xp: 7 }).eq('pack_id', pack.id);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kit reached the Kid stage!' })).toBeVisible();
});

test('in a window shorter than a phone the celebration scrolls to its button', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await signIn(page, noa);
  await page.setViewportSize({ width: 600, height: 300 });
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeVisible();
  // The phone has now seen the egg.
  await page.waitForTimeout(500);

  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 1, health: 80 }).eq('pack_id', pack.id);
  await page.reload();
  const close = page.getByRole('button', { name: 'Yay!' });
  await expect(close).toBeAttached();
  await swipeUp(page);
  await expect(close).toBeInViewport({ ratio: 1 });
  await close.click();
  await expect(close).toBeHidden();
});
