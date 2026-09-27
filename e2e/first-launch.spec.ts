import { expect, test } from '@playwright/test';

test('a first launch shows the three rules, then the sign-in screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Feed me with a photo')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('We do it together')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('I never die')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeHidden();
  await page.getByRole('button', { name: "Let's go" }).click();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

  // Shown once: the next launch goes straight to sign-in.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
});
