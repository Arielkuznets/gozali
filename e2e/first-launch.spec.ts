import { expect, test, type Locator } from '@playwright/test';

import { createSignedUpUser, removeUsers, signIn } from './support';

/** Scrolls to `text` and checks that `button` doesn't cover it. */
async function expectClearOf(text: Locator, button: Locator) {
  await text.scrollIntoViewIfNeeded();
  const textBox = (await text.boundingBox())!;
  const buttonBox = (await button.boundingBox())!;
  expect(textBox.y + textBox.height).toBeLessThanOrEqual(buttonBox.y);
}

test('a first launch shows the rules and the reward, then the sign-in screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Feed me with a photo')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('We do it together')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('I never die')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Dress me up')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeHidden();
  await page.getByRole('button', { name: "Let's go" }).click();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  // Google sign-in is off in the local project, so its button stays away.
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeHidden();

  // Shown once: the next launch goes straight to sign-in.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
});

test('in a window shorter than a phone the texts scroll instead of hiding behind the buttons', async ({ page }) => {
  // An iPad shows the app in a window people can make this short.
  await page.setViewportSize({ width: 600, height: 300 });
  await page.goto('/');
  const next = page.getByRole('button', { name: 'Next' });
  await expectClearOf(page.getByText('That is what feeds me.', { exact: false }), next);
  await next.click();
  await expectClearOf(page.getByText('I count on the whole pack.', { exact: false }), next);

  await page.getByRole('button', { name: 'Skip' }).click();
  const apple = page.getByRole('button', { name: 'Continue with Apple' });
  await expectClearOf(page.getByText('Raise a little pet together', { exact: false }), apple);
  await expect(apple).toBeInViewport({ ratio: 1 });
});

test('the Google button shows once the project turns Google sign-in on', async ({ page }) => {
  await page.route('**/auth/v1/settings', async (route) => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({ response, json: { ...settings, external: { ...settings.external, google: true } } });
  });
  await page.addInitScript(() => localStorage.setItem('gozali.onboarded', '1'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});

test('an app older than the version the server needs asks to update', async ({ page }) => {
  await page.route('**/rest/v1/app_config*', (route) =>
    route.fulfill({ json: { min_version: '99.0.0', ios_url: null, android_url: null, apple_revocation: false } }),
  );
  await page.goto('/');
  await expect(page.getByText('Time to update')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeHidden();
});

test('finishing the profile setup opens the home screen', async ({ page }) => {
  const maya = await createSignedUpUser('Maya');
  await signIn(page, maya);
  await page.goto('/');
  await page.getByPlaceholder('What do your friends call you?').fill('Maya');
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  await expect(page.getByText('Camera needed')).toBeHidden();
  await removeUsers(maya);
});
