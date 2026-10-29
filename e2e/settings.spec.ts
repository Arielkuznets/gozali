import { expect, test } from '@playwright/test';

import { createUser, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
});

test.afterEach(async () => {
  await removeUsers(noa);
});

test('turning a notification type off is saved to the profile', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/settings');
  const nudges = page.getByRole('switch', { name: 'Nudges' });
  await expect(nudges).toBeChecked();
  await nudges.click();
  await expect(nudges).not.toBeChecked();

  await expect
    .poll(async () => (await noa.client.from('profiles').select('notification_prefs').single()).data?.notification_prefs)
    .toMatchObject({ nudge: false });
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Nudges' })).not.toBeChecked();
});

test('turning two notification types off quickly keeps both off', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/settings');
  // The first save is slow to come back, so the second switch is turned before it does.
  let saves = 0;
  await page.route('**/rest/v1/profiles?**', async (route) => {
    if (route.request().method() === 'PATCH' && saves++ === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByRole('switch', { name: 'Nudges' }).click();
  await page.getByRole('switch', { name: 'Weekly recap' }).click();

  await expect
    .poll(async () => (await noa.client.from('profiles').select('notification_prefs').single()).data?.notification_prefs, {
      timeout: 10_000,
    })
    .toMatchObject({ nudge: false, weekly_recap: false });
  await page.waitForTimeout(2000);
  const { data } = await noa.client.from('profiles').select('notification_prefs').single();
  expect(data?.notification_prefs).toMatchObject({ nudge: false, weekly_recap: false });
});

test.describe('on a phone set to a bare offset', () => {
  // Android names a time zone picked by hand like GMT+02:00, which the server doesn't know and saves as UTC.
  test.use({ timezoneId: 'GMT+02:00' });

  test('the time zone is sent once, not over and over', async ({ page }) => {
    let updates = 0;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/rest/v1/profiles')) updates += 1;
    });
    await signIn(page, noa);
    await page.goto('/');
    await expect(page.getByText('No packs yet')).toBeVisible();
    await page.waitForTimeout(3000);
    expect(updates).toBe(1);
  });
});

test('deleting the account shows it is under way, and goes out once', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The real function needs `supabase functions serve`; this one answers when the test lets it.
  let calls = 0;
  let answer = () => {};
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route('**/functions/v1/delete-account', async (route) => {
    calls += 1;
    await answered;
    await route.fulfill({ json: { deleted: true, photos: 0 } });
  });
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/settings');

  const remove = page.getByRole('button', { name: 'Delete account' });
  await remove.click();
  await expect(remove).toBeDisabled();
  await remove.click({ force: true });
  answer();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  expect(calls).toBe(1);
});

test('the rules can be read again from the settings', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'How Gozali works' }).click();
  await expect(page.getByText('Feed me with a photo')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
