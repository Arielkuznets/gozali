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
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'spark' });
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
