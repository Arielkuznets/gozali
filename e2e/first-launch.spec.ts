import { expect, test, type Locator, type Page } from '@playwright/test';

import { createPack, createSignedUpUser, createUser, removeUsers, signIn, swipeUp, type TestUser } from './support';

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

test.describe('in a window shorter than a phone', () => {
  let noa: TestUser;
  let dan: TestUser;
  let pack: { id: string; inviteCode: string };

  test.beforeEach(async ({ page }) => {
    noa = await createUser('Noa');
    dan = await createUser('Dan');
    pack = await createPack(noa, { name: 'Reading club', habit: 'reading', species: 'hoot' }, [dan]);
    await signIn(page, noa);
    await page.setViewportSize({ width: 600, height: 300 });
  });

  test.afterEach(async () => {
    await removeUsers(noa, dan);
  });

  test('Not today scrolls to all it offers, clear of the buttons below', async ({ page }) => {
    await page.goto(`/pack/${pack.id}/not-today`);
    const away = page.getByRole('button', { name: 'Pause for a few days' });
    await expectClearOf(page.getByRole('button', { name: 'Use', exact: true }).last(), away);
    await expectClearOf(page.getByText('If you feed today anyway', { exact: false }), away);
  });

  test('Focus scrolls to the session without a time limit', async ({ page }) => {
    await page.goto(`/pack/${pack.id}/focus`);
    const open = page.getByRole('button', { name: 'No time limit' });
    await expect(open).toBeAttached();
    await swipeUp(page);
    await expect(open).toBeInViewport({ ratio: 1 });
  });

  test('a menu scrolls its choices and keeps its ways out', async ({ page }) => {
    await page.goto(`/pack/${pack.id}/settings`);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport({ ratio: 1 });
    await swipeUp(page);
    await expect(page.getByRole('menuitem', { name: '2 months' })).toBeInViewport({ ratio: 1 });

    // The dim part above the sheet closes it too.
    await page.mouse.click(300, 10);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('the join screen scrolls to the whole pack, clear of the buttons below', async ({ page }) => {
    await page.goto(`/join?code=${pack.inviteCode}`);
    await expectClearOf(page.getByText("You're already in this pack."), page.getByRole('button', { name: 'Open pack' }));
    await page.getByText('Join a pack').scrollIntoViewIfNeeded();
    await expect(page.getByText('Join a pack')).toBeInViewport({ ratio: 1 });
  });

  test('the join screen brings the answer to a code into view', async ({ page }) => {
    await page.goto('/join');
    await page.getByLabel('Invite code').fill('AAAAAAAA');
    await expect(page.getByText('No pack has this code.')).toBeInViewport({ ratio: 1 });
  });
});

test('in a window shorter than a phone the empty home keeps its text clear of the buttons', async ({ page }) => {
  const noa = await createUser('Noa');
  await signIn(page, noa);
  await page.setViewportSize({ width: 600, height: 300 });
  await page.goto('/');
  await expectClearOf(page.getByText('or join a pack with a code', { exact: false }), page.getByRole('button', { name: 'Create a pack' }));
  await removeUsers(noa);
});

test('in a window shorter than a phone the update screen keeps its text clear of the button', async ({ page }) => {
  await page.route('**/rest/v1/app_config*', (route) =>
    route.fulfill({ json: { min_version: '99.0.0', ios_url: 'https://example.test/app', android_url: null, apple_revocation: false } }),
  );
  await page.setViewportSize({ width: 600, height: 300 });
  await page.goto('/');
  await expectClearOf(page.getByText('right where you left them', { exact: false }), page.getByRole('button', { name: 'Update' }));
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

test('a surname that begins with a blocked word finishes the profile setup', async ({ page }) => {
  const noa = await createSignedUpUser('Noa');
  await signIn(page, noa);
  await page.goto('/');
  await page.getByPlaceholder('What do your friends call you?').fill('Noa Shitrit');
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  await removeUsers(noa);
});

test('an account the sign-in gave no name finishes the setup with the tick alone', async ({ page }) => {
  // Apple sends the name only the first time an Apple ID signs in to the app.
  const maya = await createSignedUpUser('Maya');
  await signIn(page, maya);
  await page.goto('/');
  await expect(page.getByLabel('Your name')).toHaveValue('Friend');
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  const saved = await maya.client.from('profiles').select('display_name').eq('id', maya.id).single();
  expect(saved.data?.display_name).toBe('Friend');
  await removeUsers(maya);
});

test('on a small phone the setup opens with the tick Continue waits for in view', async ({ page }) => {
  // Larger text on an iPhone SE leaves the form about as little room as this window does.
  await page.setViewportSize({ width: 320, height: 500 });
  const maya = await createSignedUpUser('Maya');
  await signIn(page, maya);
  await page.goto('/');
  await expect(page.getByText('About you')).toBeVisible();
  await expect(page.getByRole('checkbox')).toBeInViewport({ ratio: 1 });

  await expectClearOf(page.getByText("Next, we'll ask to send notifications", { exact: false }), page.getByRole('button', { name: 'Continue' }));
  await removeUsers(maya);
});

/** A link opening in the running app: the web build hears of it through the browser history. */
async function openLink(page: Page, path: string) {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
}

test.describe('someone on the profile setup', () => {
  let owner: TestUser;
  let maya: TestUser;
  let inviteCode: string;

  test.beforeEach(async () => {
    owner = await createUser('Owner');
    maya = await createSignedUpUser('Maya');
    ({ inviteCode } = await createPack(owner, { name: 'Gym squad', habit: 'gym', species: 'kit' }));
  });

  test.afterEach(async () => {
    await removeUsers(owner, maya);
  });

  test('opening an invite link stays on the setup, and the join screen opens after it', async ({ page }) => {
    await signIn(page, maya);
    await page.goto(`/i/${inviteCode}`);
    await expect(page.getByText('About you')).toBeVisible();

    await page.getByPlaceholder('What do your friends call you?').fill('Maya');
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByLabel('Invite code')).toHaveValue(inviteCode);
    await expect(page.getByText('Gym squad')).toBeVisible();
  });

  test('an invite link arriving while the setup is open stays on it, and the join screen opens after it', async ({ page }) => {
    await signIn(page, maya);
    await page.goto('/');
    await expect(page.getByText('About you')).toBeVisible();

    await openLink(page, `/i/${inviteCode}`);

    await expect(page.getByText('About you')).toBeVisible();
    await page.getByPlaceholder('What do your friends call you?').fill('Maya');
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Invite code')).toHaveValue(inviteCode);
  });

  test('a sign-in link goes back to the setup', async ({ page }) => {
    await signIn(page, maya);
    await page.goto('/auth/callback');
    await expect(page.getByText('About you')).toBeVisible();
  });
});

test('an invite link for a finished account opens the join screen with the code', async ({ page }) => {
  const owner = await createUser('Owner');
  const noa = await createUser('Noa');
  const { inviteCode } = await createPack(owner, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signIn(page, noa);
  await page.goto(`/i/${inviteCode}`);
  await expect(page.getByLabel('Invite code')).toHaveValue(inviteCode);
  await removeUsers(owner, noa);
});

test('a sign-in link for nobody signed in shows the sign-in screen', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gozali.onboarded', '1'));
  await page.goto('/auth/callback');
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
});

test('a sign-in link for a finished account opens the home screen', async ({ page }) => {
  const noa = await createUser('Noa');
  await signIn(page, noa);
  await page.goto('/auth/callback');
  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  await removeUsers(noa);
});

test.describe('a link to a screen the app does not have', () => {
  const LINKS = ['/nothing-here', '/i/', '/_sitemap', '/pack/some-pack/nothing-here'];

  test('leads to the sign-in screen for nobody signed in', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('gozali.onboarded', '1'));
    for (const link of LINKS) {
      await page.goto(link);
      await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
    }
  });

  test('leads to the home screen for a finished account', async ({ page }) => {
    const noa = await createUser('Noa');
    await signIn(page, noa);
    for (const link of LINKS) {
      await page.goto(link);
      await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
    }
    await removeUsers(noa);
  });

  test('leads to the setup for someone on it', async ({ page }) => {
    const maya = await createSignedUpUser('Maya');
    await signIn(page, maya);
    for (const link of LINKS) {
      await page.goto(link);
      await expect(page.getByText('About you')).toBeVisible();
    }
    await removeUsers(maya);
  });
});

test('this release build has no development sign-in', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gozali.onboarded', '1'));
  await page.goto('/dev-login');
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dev login with email' })).toBeHidden();
  await expect(page.getByPlaceholder('Email')).toBeHidden();
});
