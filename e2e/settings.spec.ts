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

test('the rules can be read again from the settings', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'How Gozali works' }).click();
  await expect(page.getByText('Feed me with a photo')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
