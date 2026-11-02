import { addDays, packDayOf } from '@gozali/game-engine';
import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
});

test.afterEach(async () => {
  await removeUsers(noa, dan);
});

test('a rest day is on the pack when its screen closes, and Undo takes it back', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Rest test', habit: 'gym', species: 'kit' }, [dan]);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);

  await page.getByRole('button', { name: 'Not today' }).click();
  await page.getByRole('button', { name: 'Use', exact: true }).first().click();

  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(page.getByLabel('Noa, resting today')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText("You're resting today.").last()).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByRole('button', { name: 'Use', exact: true })).toHaveCount(2);
  const { data: passes } = await noa.client.from('day_passes').select('kind');
  expect(passes).toEqual([]);
});

test('a double tap on Create pack makes one pack', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/create-pack');
  await page.getByLabel('Pack name').fill('Morning runs');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Running' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create pack' }).dblclick();

  await expect(page.getByText('Invite your friends')).toBeVisible();
  await page.waitForTimeout(1000);
  const { data: packs } = await noa.client.from('packs').select('id');
  expect(packs).toHaveLength(1);
});

test('creating a pack takes four steps and ends on the invite', async ({ page }) => {
  await signIn(page, noa);
  await page.goto('/');
  await expect(page.getByText('No packs yet')).toBeVisible();
  await page.getByRole('button', { name: 'Create a pack' }).click();

  await page.getByLabel('Pack name').fill('Morning runs');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Running' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Rest days', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^Hoot/ }).click();
  await page.getByRole('button', { name: 'Create pack' }).click();

  await expect(page.getByText('Invite your friends')).toBeVisible();
  const { data: packs } = await noa.client.from('packs').select('id, name, category, invite_code');
  expect(packs).toEqual([expect.objectContaining({ name: 'Morning runs', category: 'running' })]);
  const created = packs![0]!;
  await expect(page.getByText(created.invite_code)).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(new RegExp(`/pack/${created.id}$`));
});

test('joining with a code shows the pack first, then opens it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signIn(page, dan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Invite code').fill(pack.inviteCode.toLowerCase());

  await expect(page.getByText('Gym squad')).toBeVisible();
  await expect(page.getByText('Noa', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Join pack' }).click();

  await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
  const { data: members } = await dan.client.from('pack_members').select('user_id').eq('pack_id', pack.id);
  expect(members).toHaveLength(2);
});

test('pasting the whole invite message finds the code in it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
  await signIn(page, dan);
  await page.goto('/join');
  // What the invite screen shares, as it arrives in a chat.
  await page
    .getByLabel('Invite code')
    .fill(`Join my pack "Gym squad" on Gozali! Code: ${pack.inviteCode}\nhttps://gozali.app/i/${pack.inviteCode}`);

  await expect(page.getByLabel('Invite code')).toHaveValue(pack.inviteCode);
  await expect(page.getByText('Gym squad')).toBeVisible();

  await page.getByLabel('Invite code').fill(`https://gozali.app/i/${pack.inviteCode.toLowerCase()}`);
  await expect(page.getByLabel('Invite code')).toHaveValue(pack.inviteCode);
});

test('a name that starts with an emoji shows the whole emoji in the member circle', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const renamed = await dan.client.from('profiles').update({ display_name: '🌸 Dan' }).eq('id', dan.id);
  expect(renamed.error).toBeNull();
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);

  await expect(page.getByText('🌸 Dan').first()).toBeVisible();
  // The circle shows the first character as the name's initial: the whole emoji, not half of it.
  await expect(page.getByText('🌸', { exact: true })).toBeVisible();
});

test('the admin replaces a leaked invite code, and only the admin can', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/invite`);
  await expect(page.getByText(pack.inviteCode)).toBeVisible();

  await page.getByRole('button', { name: 'Get a new code' }).click();
  await expect(page.getByText(pack.inviteCode)).toBeHidden();
  const { data } = await noa.client.from('packs').select('invite_code').eq('id', pack.id).single();
  expect(data!.invite_code).not.toBe(pack.inviteCode);
  await expect(page.getByText(data!.invite_code)).toBeVisible();

  // Other members can't replace it.
  const { error } = await dan.client.rpc('renew_invite_code', { target: pack.id });
  expect(error?.message).toContain('admin_only');
});

test("a member who isn't the admin is told the settings are the admin's", async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await signIn(page, dan);
  await page.goto(`/pack/${pack.id}/settings`);

  await expect(page.getByText('Only the admin, Noa, can change', { exact: false })).toBeVisible();
  await expect(page.getByRole('radio', { name: '2 rest days a week' })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Monday' })).toBeDisabled();
});

test('leaving a pack ends on the home screen', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, dan);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Leave pack' })).toBeVisible();
  // The list of packs answers after the pack itself, as it can over a real connection.
  await page.route(/\/rest\/v1\/packs\?.*order=/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Leave pack' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  await expect(page.getByText("This pack isn't here")).toBeHidden();
  const { data: packs } = await dan.client.from('packs').select('id');
  expect(packs).toEqual([]);
});

test('a member who dozed off is told how to come back', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
  await admin.from('pack_members').update({ status: 'sleeping' }).eq('pack_id', pack.id).eq('user_id', noa.id);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText("One photo and you're back.", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Noa, asleep' })).toBeVisible();
});

test.describe('a member on a pause', () => {
  const onPause = "You're on a pause until";

  /** A pack of a sitting habit where Noa's pause is running: the app can only start one for tomorrow. */
  async function pausedPack() {
    const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'kit' }, [dan]);
    await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
    const today = packDayOf(new Date(), 'Asia/Jerusalem');
    const paused = await admin.from('pauses').insert({
      pack_id: pack.id,
      user_id: noa.id,
      starts_on: addDays(today, -1),
      ends_on: addDays(today, 5),
    });
    if (paused.error) throw paused.error;
    return pack;
  }

  test('is told so on the pack, where nothing offers a photo that would not count', async ({ page }) => {
    const pack = await pausedPack();
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);

    await expect(page.getByText(onPause, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Noa, on a pause' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Not today' })).toBeHidden();
  });

  test('has no Feed on the card on the home screen', async ({ page }) => {
    await pausedPack();
    await signIn(page, noa);
    await page.goto('/');

    await expect(page.getByLabel('On a pause')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Feed Study buddies' })).toBeHidden();
  });

  for (const [from, link] of [
    ['a widget or a reminder', 'feed'],
    ['a focus session that ended', 'feed?focus=25'],
  ] as const) {
    test(`goes to the pack from ${from}, not to the camera`, async ({ context, page }) => {
      await context.grantPermissions(['camera']);
      const pack = await pausedPack();
      await signIn(page, noa);
      await page.goto(`/pack/${pack.id}/${link}`);

      await expect(page.getByText(onPause, { exact: false })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
      await expect(page.getByRole('button', { name: 'Take photo' })).toBeHidden();
    });
  }

  test('is not one of those who fed, even with a photo sent from an older app', async ({ page }) => {
    const pack = await pausedPack();
    await feed(noa, pack.id, await photo(page, '📚'), 'On the road');
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);

    await expect(page.getByText(onPause, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Noa, on a pause' })).toBeVisible();
    await expect(page.getByText('Your part is done for today', { exact: false })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Post another photo' })).toBeHidden();
  });

  test('feeds again once the pause is over', async ({ page }) => {
    const pack = await pausedPack();
    const today = packDayOf(new Date(), 'Asia/Jerusalem');
    await admin.from('pauses').update({ ends_on: addDays(today, -1) }).eq('pack_id', pack.id);
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);

    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeVisible();
    await expect(page.getByText(onPause, { exact: false })).toBeHidden();
  });
});

test.describe('new rest days in a pack of one', () => {
  // With nobody to close a day against, the change stays pending past its date.
  const today = () => packDayOf(new Date(), 'Asia/Jerusalem');
  const waiting = /^New rest days and week start apply from /;

  /** A pack of one with three rest days saved, and the date they start on moved to `from`. */
  async function restDaysFrom(from: string) {
    const pack = await createPack(noa, { name: 'Alone', habit: 'gym', species: 'kit' });
    const saved = await noa.client.rpc('update_pack', { target: pack.id, pack_name: 'Alone', rest_days: 3, starts_on: 'sunday' });
    if (saved.error) throw saved.error;
    const moved = await admin.from('packs').update({ pending_from: from }).eq('id', pack.id);
    if (moved.error) throw moved.error;
    return pack;
  }

  test('say when they start, and the old ones count until then', async ({ page }) => {
    const pack = await restDaysFrom(addDays(today(), 3));
    await signIn(page, noa);

    await page.goto(`/pack/${pack.id}/settings`);
    await expect(page.getByText(waiting)).toBeVisible();
    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText('1 rest day a week')).toBeVisible();
    await page.goto(`/pack/${pack.id}/not-today`);
    await expect(page.getByText('1 left this week')).toBeVisible();
  });

  for (const [when, daysAgo] of [['today', 0], ['a week ago', 7]] as const) {
    test(`that started ${when} read the same on every screen`, async ({ page }) => {
      const pack = await restDaysFrom(addDays(today(), -daysAgo));
      await signIn(page, noa);

      await page.goto(`/pack/${pack.id}/settings`);
      await expect(page.getByRole('radio', { name: '3 rest days a week' })).toBeVisible();
      await expect(page.getByText(waiting)).toBeHidden();
      await page.goto(`/pack/${pack.id}`);
      await expect(page.getByText('3 rest days a week')).toBeVisible();
      await page.goto(`/pack/${pack.id}/not-today`);
      await expect(page.getByText('3 left this week')).toBeVisible();
    });
  }
});
