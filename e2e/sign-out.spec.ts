import { expect, test } from '@playwright/test';

import { createUser, removeUsers, signIn, signInElsewhere, type TestUser } from './support';

let noa: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
});

test.afterEach(async () => {
  await removeUsers(noa);
});

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
