import { expect, test, type Page } from '@playwright/test';

import { admin, createPack, createUser, layOutTextLikeAPhone, removeUsers, signIn, type TestUser } from './support';

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

test('turning three notification types off quickly keeps all three off', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/settings');
  // The first two saves are slow to come back, so the next switches are turned before they do.
  let saves = 0;
  await page.route('**/rest/v1/profiles?**', async (route) => {
    if (route.request().method() === 'PATCH' && saves++ < 2) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const recap = page.getByRole('switch', { name: 'Weekly recap' });
  await page.getByRole('switch', { name: 'Nudges' }).click();
  await recap.click();
  // The first save is back and the second is still out: the second switch is still off right now,
  // and the third choice is made from it.
  await page.waitForTimeout(2000);
  expect(await recap.isChecked()).toBe(false);
  await page.getByRole('switch', { name: 'Hatching, growing and achievements' }).click();

  const prefs = async () => (await noa.client.from('profiles').select('notification_prefs').single()).data?.notification_prefs;
  const allOff = { nudge: false, weekly_recap: false, evolution: false };
  await expect.poll(prefs, { timeout: 10_000 }).toMatchObject(allOff);
  await page.waitForTimeout(2000);
  expect(await prefs()).toMatchObject(allOff);
  await expect(recap).not.toBeChecked();
});

test('a switch whose save fails goes back and says so', async ({ page }) => {
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.dismiss();
  });
  await signIn(page, noa);
  await page.goto('/settings');
  const nudges = page.getByRole('switch', { name: 'Nudges' });
  await expect(nudges).toBeChecked();
  // Offline the refetch can't put it right either.
  await page.route('**/rest/v1/profiles?**', (route) => route.abort('internetdisconnected'));

  await nudges.click();

  await expect.poll(() => alerts).toEqual(["Saving didn't work. Please try again."]);
  await expect(nudges).toBeChecked();
});

test.describe('with someone blocked', () => {
  let dan: TestUser;

  test.beforeEach(async () => {
    dan = await createUser('Dan');
    await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
    const blocked = await noa.client.from('blocks').insert({ blocker_id: noa.id, blocked_id: dan.id });
    if (blocked.error) throw blocked.error;
  });

  test.afterEach(async () => {
    await removeUsers(dan);
  });

  test('an unblock that fails says so and leaves them listed', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    await signIn(page, noa);
    await page.goto('/settings');
    await expect(page.getByText('Dan')).toBeVisible();
    await page.route('**/rest/v1/blocks?**', (route) =>
      route.request().method() === 'DELETE' ? route.abort('internetdisconnected') : route.continue(),
    );

    await page.getByRole('button', { name: 'Unblock' }).click();

    await expect.poll(() => alerts).toEqual(["Saving didn't work. Please try again."]);
    await expect(page.getByText('Dan')).toBeVisible();
  });
});

async function createAPack(page: Page) {
  await page.goto('/create-pack');
  await page.getByLabel('Pack name').fill('Morning runs');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Running' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create pack' }).click();
  await expect(page.getByText('Invite your friends')).toBeVisible();
}

test.describe('on a phone set to a bare offset', () => {
  // Android names a time zone picked by hand like GMT+02:00, and the browser reports +02:00.
  // Neither is a name the server knows.
  test.use({ timezoneId: 'GMT+02:00' });

  test('the time zone is sent once, under the name of that offset', async ({ page }) => {
    let updates = 0;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/rest/v1/profiles')) updates += 1;
    });
    await signIn(page, noa);
    await page.goto('/');
    await expect(page.getByText('No packs yet')).toBeVisible();
    await page.waitForTimeout(3000);
    expect(updates).toBe(1);
    const { data: profile } = await noa.client.from('profiles').select('timezone').single();
    expect(profile?.timezone).toBe('Etc/GMT-2');
  });

  test('a pack can be created, in the zone of that offset', async ({ page }) => {
    await signIn(page, noa);
    await createAPack(page);

    const { data: packs } = await noa.client.from('packs').select('timezone');
    expect(packs).toEqual([{ timezone: 'Etc/GMT-2' }]);
  });
});

test.describe('on a phone set to an offset that is not a whole hour', () => {
  // No Etc zone has it, so the pack runs on UTC.
  test.use({ timezoneId: 'GMT+05:30' });

  test('a pack can still be created', async ({ page }) => {
    await signIn(page, noa);
    await createAPack(page);

    const { data: packs } = await noa.client.from('packs').select('timezone');
    expect(packs).toEqual([{ timezone: 'UTC' }]);
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

test('a deletion whose answer never reached the phone finishes there', async ({ page }) => {
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') alerts.push(dialog.message());
    void dialog.accept();
  });
  // The account goes on the server, and the connection drops before the answer comes back.
  await page.route('**/functions/v1/delete-account', async (route) => {
    await admin.auth.admin.deleteUser(noa.id);
    await route.abort('connectionreset');
  });
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/settings');

  await page.getByRole('button', { name: 'Delete account' }).click();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  expect(alerts).toEqual([]);
});

test('a deletion whose answer was lost with the connection finishes on the next try', async ({ page }) => {
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') alerts.push(dialog.message());
    void dialog.accept();
  });
  let connected = false;
  await page.route('**/functions/v1/delete-account', async (route) => {
    // From the second try on the function turns the token down, as it does for a deleted account.
    if (connected) return await route.fulfill({ status: 401, body: 'not signed in' });
    await admin.auth.admin.deleteUser(noa.id);
    await route.abort('connectionreset');
  });
  await page.route('**/auth/v1/**', (route) => (connected ? route.continue() : route.abort('internetdisconnected')));
  await page.addInitScript(() => window.localStorage.setItem('gozali.onboarded', '1'));
  await signIn(page, noa);
  await page.goto('/settings');
  const remove = page.getByRole('button', { name: 'Delete account' });

  await remove.click();
  await expect.poll(() => alerts).toEqual(["The account wasn't deleted. Please try again."]);
  await expect(remove).toBeEnabled();

  connected = true;
  await remove.click();

  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  expect(alerts).toHaveLength(1);
});

test('a deletion that failed says so while the account is still there', async ({ page }) => {
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') alerts.push(dialog.message());
    void dialog.accept();
  });
  await page.route('**/functions/v1/delete-account', (route) => route.fulfill({ status: 500, json: { error: 'photo removal failed' } }));
  await signIn(page, noa);
  await page.goto('/settings');
  const remove = page.getByRole('button', { name: 'Delete account' });

  await remove.click();

  await expect.poll(() => alerts).toEqual(["The account wasn't deleted. Please try again."]);
  await expect(remove).toBeEnabled();
});

test('a long name leaves the way to the settings on the screen', async ({ page }) => {
  await noa.client.from('profiles').update({ display_name: 'Bartholomew Montgomery-Smithso' }).eq('id', noa.id);
  await signIn(page, noa);
  await page.goto('/me');
  const name = page.getByText('Bartholomew Montgomery-Smithso');
  await expect(name).toBeVisible();
  await layOutTextLikeAPhone(page);

  const settings = page.getByRole('button', { name: 'Settings' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(settings).toBeInViewport({ ratio: 1 });
    const nameBox = (await name.boundingBox())!;
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual((await settings.boundingBox())!.x);
  }

  await settings.click();
  await expect(page.getByRole('button', { name: 'Delete account' })).toBeVisible();
});

test.describe('changing your name', () => {
  const field = (page: Page) => page.getByLabel('Your name');
  const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
  const back = (page: Page) => page.getByRole('button', { name: 'Back', exact: true }).first();
  const savedName = async () => (await noa.client.from('profiles').select('display_name').single()).data?.display_name;

  test('shows on Me and stays after a reload', async ({ page }) => {
    await signIn(page, noa);
    await page.goto('/me');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(field(page)).toHaveValue('Noa');

    await field(page).fill('  Noa K  ');
    await save(page).click();

    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
    expect(await savedName()).toBe('Noa K');
    await back(page).click();
    await expect(page.getByText('Noa K')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Noa K')).toBeVisible();
  });

  test('reaches the packs the phone keeps, with no connection to ask', async ({ page }) => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' });
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}/settings`);
    await expect(page.getByText('Noa', { exact: true })).toBeVisible();
    await back(page).click();
    await page.getByRole('button', { name: 'Me' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await field(page).fill('Noa K');
    await save(page).click();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

    await page.route('**/rest/v1/packs?**', (route) => route.abort('internetdisconnected'));
    await back(page).click();
    await back(page).click();
    await page.getByRole('button', { name: /^Axo, an egg Gym squad/ }).click();

    await expect(page.getByLabel('Noa K, not yet today')).toBeVisible();
  });

  test('has to have something in it and stops at 30 characters', async ({ page }) => {
    await signIn(page, noa);
    await page.goto('/settings');
    await expect(field(page)).toHaveValue('Noa');
    await expect(save(page)).toBeDisabled();

    await field(page).fill('   ');
    await expect(save(page)).toBeDisabled();

    await field(page).fill('');
    await field(page).pressSequentially('x'.repeat(31));
    await expect(field(page)).toHaveValue('x'.repeat(30));
    await expect(save(page)).toBeEnabled();
  });

  test('a word the filter turns down says so and leaves the name to be fixed', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    await signIn(page, noa);
    await page.goto('/me');
    await page.getByRole('button', { name: 'Settings' }).click();

    await field(page).fill('Bitchy');
    await save(page).click();

    await expect.poll(() => alerts).toEqual(["Let's keep it friendly: that has a word we don't allow."]);
    await expect(field(page)).toHaveValue('Bitchy');
    await expect(save(page)).toBeEnabled();
    expect(await savedName()).toBe('Noa');
    await back(page).click();
    await expect(page.getByText('Noa', { exact: true })).toBeVisible();
  });

  test('a save turned down after leaving the screen still says so', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    await signIn(page, noa);
    await page.goto('/me');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(field(page)).toHaveValue('Noa');
    await page.route('**/rest/v1/profiles?**', async (route) => {
      if (route.request().method() === 'PATCH') await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

    await field(page).fill('Bitchy');
    await save(page).click();
    await back(page).click();

    await expect.poll(() => alerts).toEqual(["Let's keep it friendly: that has a word we don't allow."]);
    await expect(page.getByText('Noa', { exact: true })).toBeVisible();
  });

  test('a save that fails says so and goes back to the old name', async ({ page }) => {
    const alerts: string[] = [];
    page.on('dialog', (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    await signIn(page, noa);
    await page.goto('/me');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(field(page)).toHaveValue('Noa');
    await page.route('**/rest/v1/profiles?**', (route) => route.abort('internetdisconnected'));

    await field(page).fill('Noa K');
    await save(page).click();

    await expect.poll(() => alerts).toEqual(["Saving didn't work. Please try again."]);
    await expect(field(page)).toHaveValue('Noa K');
    await expect(save(page)).toBeEnabled();
    await back(page).click();
    await expect(page.getByText('Noa', { exact: true })).toBeVisible();
  });
});

test('the rules can be read again from the settings', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'How Gozali works' }).click();
  await expect(page.getByText('Feed me with a photo')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/settings$/);
});
