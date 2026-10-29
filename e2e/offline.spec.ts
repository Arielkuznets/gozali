import { expect, test } from '@playwright/test';

import { createPack, createUser, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
});

test.afterEach(async () => {
  await removeUsers(noa);
});

test('a pack that fails to load offers to try again, not "pack missing"', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  const packRequests = '**/rest/v1/packs?**';
  await page.route(packRequests, (route) => route.abort('internetdisconnected'));
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);

  // The query retries a few times before it gives up.
  await expect(page.getByText("This didn't load")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("This pack isn't here")).toBeHidden();

  await page.unroute(packRequests);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeVisible();
});

test('a profile that fails to load offers to try again, not the profile setup', async ({ page }) => {
  const profileRequests = '**/rest/v1/profiles?**';
  await page.route(profileRequests, (route) => route.abort('internetdisconnected'));
  await signIn(page, noa);
  await page.goto('/');

  await expect(page.getByText("This didn't load")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('About you')).toBeHidden();

  await page.unroute(profileRequests);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Your packs')).toBeVisible();
});
