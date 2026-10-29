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

/** Blocks every call to the server, as a phone without a connection would find it. */
async function goOffline(page: import('@playwright/test').Page) {
  for (const path of ['rest', 'auth', 'storage', 'functions', 'realtime']) {
    await page.route(`**/${path}/v1/**`, (route) => route.abort('internetdisconnected'));
  }
}

test('opening the app without a connection shows the packs it last had', async ({ page }) => {
  await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signIn(page, noa);
  await page.goto('/');
  await expect(page.getByText('Gym squad')).toBeVisible();
  // The copy kept on the phone is written a moment after the screen has its data.
  await page.waitForTimeout(1500);

  await goOffline(page);
  await page.reload();
  await expect(page.getByText('Gym squad')).toBeVisible();
  await expect(page.getByText("This didn't load")).toBeHidden();
});

test('offline with an expired sign-in, the app still opens on the packs', async ({ page }) => {
  await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  // Signed in once; later loads keep what the page has stored, as a phone does.
  await page.addInitScript((session) => {
    if (!window.localStorage.getItem('sb-127-auth-token')) {
      window.localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
    }
  }, noa.session);
  await page.goto('/');
  await expect(page.getByText('Gym squad')).toBeVisible();
  await page.waitForTimeout(1500);

  // An hour later, still without a connection: the access token has expired and can't be refreshed.
  await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('sb-127-auth-token')!);
    stored.expires_at = Math.floor(Date.now() / 1000) - 3600;
    window.localStorage.setItem('sb-127-auth-token', JSON.stringify(stored));
  });
  await goOffline(page);
  await page.reload();
  await expect(page.getByText('Gym squad')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeHidden();
});
