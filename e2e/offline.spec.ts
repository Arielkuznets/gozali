import { expect, test } from '@playwright/test';

import { createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from './support';

/** Signs in once; later loads keep whatever the page has stored since, as a phone does. */
async function signInOnce(page: import('@playwright/test').Page, user: TestUser) {
  await page.addInitScript((session) => {
    window.localStorage.setItem('gozali.onboarded', '1');
    if (!window.localStorage.getItem('sb-127-auth-token')) {
      window.localStorage.setItem('sb-127-auth-token', JSON.stringify(session));
    }
  }, user.session);
}

const keptCopy = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.localStorage.getItem('gozali.query-cache') ?? '');

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
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden();

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

  // The refetches give up after their retries; the copy keeps what they couldn't replace.
  await page.waitForTimeout(12_000);
  await page.reload();
  await expect(page.getByText('Gym squad')).toBeVisible();
});

test('opening the app without a connection still says who fed today', async ({ page }) => {
  const dan = await createUser('Dan');
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'Noa fed');
  await feed(dan, pack.id, image, 'Dan fed');
  await signIn(page, noa);
  await page.goto('/');
  await expect(page.getByText('2/2 fed today')).toBeVisible();
  await page.getByText('Gym squad').click();
  await expect(page.getByText('Dan fed')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(page.getByText('Your packs')).toBeVisible();
  await page.waitForTimeout(1500);

  await goOffline(page);
  await page.reload();
  await expect(page.getByText('2/2 fed today')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Feed Gym squad' })).toBeHidden();

  await page.getByText('Gym squad').click();
  await expect(page.getByText('Two of you fed today')).toBeVisible();
  await expect(page.getByText('Your part is done for today ✓')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeHidden();
  await removeUsers(dan);
});

test("another account on the phone never gets the last one's packs", async ({ page }) => {
  const dan = await createUser('Dan');
  await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signInOnce(page, noa);
  await page.goto('/');
  await expect(page.getByText('Gym squad')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await keptCopy(page)).toContain('Gym squad');

  // Noa's session ended where the app didn't see it, and Dan signed in on the same phone.
  await page.evaluate((session) => window.localStorage.setItem('sb-127-auth-token', JSON.stringify(session)), dan.session);
  await page.reload();
  await expect(page.getByText('No packs yet')).toBeVisible();
  expect(await keptCopy(page)).not.toContain('Gym squad');
  await removeUsers(dan);
});

test('a refresh the server refuses ends the session and forgets the copy', async ({ page }) => {
  await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signInOnce(page, noa);
  await page.goto('/');
  await expect(page.getByText('Gym squad')).toBeVisible();
  await page.waitForTimeout(1500);

  // The access token has expired, and the server turns the refresh down (the account was deleted elsewhere).
  await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('sb-127-auth-token')!);
    stored.expires_at = Math.floor(Date.now() / 1000) - 3600;
    window.localStorage.setItem('sb-127-auth-token', JSON.stringify(stored));
  });
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }) }),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  expect(await keptCopy(page)).not.toContain('Gym squad');
});

test('offline with an expired sign-in, the app still opens on the packs', async ({ page }) => {
  await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signInOnce(page, noa);
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

/** Refuses every call to the server, as a restricted project does. */
async function restrictProject(page: import('@playwright/test').Page) {
  const body = JSON.stringify({ message: 'Service for this project is restricted' });
  for (const path of ['rest', 'auth', 'storage', 'functions']) {
    await page.route(`**/${path}/v1/**`, (route) => route.fulfill({ status: 402, contentType: 'application/json', body }));
  }
}

test('a restricted project keeps an expired sign-in on the packs', async ({ page }) => {
  await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signInOnce(page, noa);
  await page.goto('/');
  await expect(page.getByText('Gym squad')).toBeVisible();
  await page.waitForTimeout(1500);

  // An hour later the access token has expired, and every call comes back refused, the refresh too.
  await page.evaluate(() => {
    const stored = JSON.parse(window.localStorage.getItem('sb-127-auth-token')!);
    stored.expires_at = Math.floor(Date.now() / 1000) - 3600;
    window.localStorage.setItem('sb-127-auth-token', JSON.stringify(stored));
  });
  await restrictProject(page);
  let refreshes = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('grant_type=refresh_token')) refreshes += 1;
  });
  await page.reload();

  // The refusal says nothing about the token, so the refresh goes on trying and the session stays.
  await expect.poll(() => refreshes).toBeGreaterThan(1);
  await expect(page.getByText('Gym squad')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeHidden();
  expect(await keptCopy(page)).toContain('Gym squad');
});
