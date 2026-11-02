import { expect, test, type Page } from '@playwright/test';

import { admin, createSignedUpUser, createUser, removeUsers, signIn, signInElsewhere, type TestUser } from './support';

let noa: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
});

test.afterEach(async () => {
  await removeUsers(noa);
});

/** A push token saved for the user, and how many rows the server has for it. */
async function registerToken(user: TestUser) {
  const token = `ExponentPushToken[e2e-${user.id}]`;
  const { error } = await user.client.rpc('register_push_token', { device_token: token, device: 'ios' });
  if (error) throw error;
  const rowsOnServer = async () => (await admin.from('push_tokens').select('token').eq('token', token)).data?.length;
  return { token, rowsOnServer };
}

test('signing out without a connection signs out, without saying it failed', async ({ page }) => {
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.dismiss();
  });
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/me');
  await page.route('**/auth/v1/logout**', (route) => route.abort('internetdisconnected'));

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  expect(alerts).toEqual([]);
});

test("the copy of the account's data stays gone after signing out", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/me');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();

  // Past the second a save can be held back.
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => window.localStorage.getItem('gozali.query-cache'))).toBeNull();
});

test('a phone that signed out offline has the server forget its push token once it is back', async ({ context, page }) => {
  const { token, rowsOnServer } = await registerToken(noa);
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/me');
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await expect(signOut).toBeVisible();
  // The web build never registers a token, so the phone's memory of one is put there by hand.
  await page.evaluate((value) => window.localStorage.setItem('gozali.push-token', value), token);
  await page.route(/\/(rest|auth)\/v1\//, (route) => route.abort('internetdisconnected'));

  await signOut.click();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  expect(await rowsOnServer()).toBe(1);

  // The app starts again signed out, with a connection.
  await page.close();
  const restarted = await context.newPage();
  await restarted.goto('/');
  await expect(restarted.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect.poll(rowsOnServer).toBe(0);
});

test('a session the server ended takes its push token along', async ({ page }) => {
  const { token, rowsOnServer } = await registerToken(noa);
  await page.addInitScript((value) => {
    window.localStorage.setItem('gozali.onboarded', '1');
    window.localStorage.setItem('gozali.push-token', value);
  }, token);
  await signIn(page, { ...noa, session: { ...noa.session, expires_at: Math.floor(Date.now() / 1000) - 3600 } });
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'refresh_token_not_found', message: 'Invalid Refresh Token' }) }),
  );

  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect.poll(rowsOnServer).toBe(0);
});

test('signing out on one phone leaves the other phone signed in', async ({ page }) => {
  const otherPhone = await signInElsewhere(noa);
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/me');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();

  // The other phone keeps its session, and with it its pushes and widgets make sense.
  const { error } = await otherPhone.auth.refreshSession();
  expect(error).toBeNull();
});

test.describe('when the profile will not load', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
    await signIn(page, noa);
  });

  test('an account deleted elsewhere can leave, with its token still good', async ({ page }) => {
    await admin.auth.admin.deleteUser(noa.id);
    await page.goto('/');
    // The query retries a few times before it gives up.
    await expect(page.getByText("This didn't load")).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('sb-127-auth-token'))).toBeNull();
  });

  test('signing out without a connection signs out, without saying it failed', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    await page.route(/\/(rest|auth)\/v1\//, (route) => route.abort('internetdisconnected'));
    await page.goto('/');
    await expect(page.getByText("This didn't load")).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    expect(alerts).toEqual([]);
  });

  test('asks first with a feed waiting, and cancelling keeps it and the session', async ({ page }) => {
    const QUEUE_KEY = 'gozali.feed-queue';
    const asked: string[] = [];
    let yes = false;
    page.on('dialog', (dialog) => {
      asked.push(dialog.message());
      void (yes ? dialog.accept() : dialog.dismiss());
    });
    // The web build keeps no feeds of its own, so the list is put there by hand.
    const waiting = JSON.stringify([{ id: 'waiting', packId: 'pack', userId: noa.id, photoUri: 'waiting.jpg', caption: null, capturedAt: '2026-11-01T20:00:00Z', focusMinutes: null, extra: false }]);
    await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [QUEUE_KEY, waiting]);
    await page.route(/\/(rest|auth)\/v1\//, (route) => route.abort('internetdisconnected'));
    await page.goto('/');
    await expect(page.getByText("This didn't load")).toBeVisible({ timeout: 30_000 });
    const signOut = page.getByRole('button', { name: 'Sign out' });

    await signOut.click();

    await expect.poll(() => asked).toEqual(["Sign out?\n\n1 feed hasn't gone out yet. Signing out deletes it and its photo."]);
    await expect(page.getByText("This didn't load")).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), QUEUE_KEY)).toBe(waiting);
    expect(await page.evaluate(() => window.localStorage.getItem('sb-127-auth-token'))).not.toBeNull();

    yes = true;
    await signOut.click();

    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), QUEUE_KEY)).toBeNull();
  });
});

test.describe('on the profile setup', () => {
  let maya: TestUser;

  test.beforeEach(async ({ page }) => {
    maya = await createSignedUpUser('Maya');
    await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
    await signIn(page, maya);
    await page.goto('/');
    await expect(page.getByText('About you')).toBeVisible();
  });

  test.afterEach(async () => {
    await removeUsers(maya);
  });

  /** What Continue needs: the name and the tick. */
  async function fillIn(page: Page) {
    await page.getByPlaceholder('What do your friends call you?').fill('Maya');
    await page.getByRole('checkbox').click();
  }

  test('signing out opens the sign-in screen', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('sb-127-auth-token'))).toBeNull();
  });

  test('signing out without a connection signs out, without saying it failed', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    await page.route(/\/(rest|auth)\/v1\//, (route) => route.abort('internetdisconnected'));

    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    expect(alerts).toEqual([]);
  });

  test('Continue waits while signing out, and nothing is saved', async ({ page }) => {
    await fillIn(page);
    let answer = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await page.route('**/auth/v1/logout**', async (route) => {
      await answered;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Sign out' }).click();
    const next = page.getByRole('button', { name: 'Continue' });
    await expect(next).toBeDisabled();
    await next.click({ force: true });
    answer();

    await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    const { data } = await admin.from('profiles').select('display_name, terms_accepted_at').eq('id', maya.id).single();
    expect(data).toEqual({ display_name: null, terms_accepted_at: null });
  });

  test('Sign out waits while the setup is saving', async ({ page }) => {
    await fillIn(page);
    let answer = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await page.route('**/rest/v1/profiles?**', async (route) => {
      if (route.request().method() === 'PATCH') await answered;
      await route.continue();
    });

    await page.getByRole('button', { name: 'Continue' }).click();
    const signOut = page.getByRole('button', { name: 'Sign out' });
    await expect(signOut).toBeDisabled();
    await signOut.click({ force: true });
    answer();

    await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  });

  test('in a window shorter than a phone Sign out stays in view, well away from Continue', async ({ page }) => {
    // An iPad shows the app in a window people can make this short.
    await page.setViewportSize({ width: 600, height: 300 });
    const signOut = page.getByRole('button', { name: 'Sign out' });
    const next = page.getByRole('button', { name: 'Continue' });
    await expect(signOut).toBeInViewport({ ratio: 1 });
    await expect(next).toBeInViewport({ ratio: 1 });

    const top = (await signOut.boundingBox())!;
    const bottom = (await next.boundingBox())!;
    expect(bottom.y - (top.y + top.height)).toBeGreaterThan(top.height);
  });
});
