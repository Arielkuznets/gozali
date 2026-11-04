import { addDays, packDayOf } from '@gozali/game-engine';
import { expect, test, type Page } from '@playwright/test';

import {
  admin,
  createPack,
  createUser,
  doubleButtonText,
  feed,
  layOutTextLikeAPhone,
  listening,
  photo,
  removeUsers,
  signIn,
  watchSocket,
  type TestUser,
} from './support';

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

// Realtime brings the line, but not the delete that takes it out (decision D23).
test("a joker's line leaves the feed of the phone that took the joker back", async ({ page }) => {
  const pack = await createPack(noa, { name: 'Joker test', habit: 'gym', species: 'kit' }, [dan]);
  await signIn(page, noa);
  const socket = await watchSocket(page);
  await page.goto(`/pack/${pack.id}`);
  await listening(socket, pack.id);

  await page.getByRole('button', { name: 'Not today' }).click();
  await page.getByRole('button', { name: 'Use', exact: true }).nth(1).click();
  await expect(page.getByText(/^🃏 Noa /)).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Your joker covers today.').last()).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: 'Use', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Close' }).click();

  await expect(page.getByRole('button', { name: 'Not today' })).toBeVisible();
  await expect(page.getByText(/^🃏 Noa /)).toBeHidden();
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
  // A code posted in public lets anyone in at once, with the pack's photos.
  await expect(page.getByText("Anyone with this code can join and see the pack's photos.", { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(new RegExp(`/pack/${created.id}$`));
});

test('a habit of your own shows its field on a small phone, under the habits', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await signIn(page, noa);
  await page.goto('/create-pack');
  await page.getByLabel('Pack name').fill('Clay club');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('radio', { name: 'Custom' }).click();

  await expect(page.getByLabel('Your habit')).toBeInViewport({ ratio: 1 });
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

test("the admin is told before a removal that the member can't come back", async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/settings`);

  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect.poll(() => asked).toEqual([expect.stringContaining("They can't come back")]);
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeHidden();
  const { data: removed } = await admin.from('pack_members').select('removed_at').eq('pack_id', pack.id).eq('user_id', dan.id).single();
  expect(removed?.removed_at).not.toBeNull();
});

test('the buttons at the top of a pack stay on the screen at the largest text', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const buttons = ['Back', 'Invite', 'Settings'].map((name) => page.getByRole('button', { name, exact: true }));
  await expect(buttons[2]!).toBeVisible();
  await layOutTextLikeAPhone(page);
  await doubleButtonText(page);

  for (const width of [390, 375, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const button of buttons) await expect(button).toBeInViewport({ ratio: 1 });
  }

  await buttons[2]!.click();
  await expect(page.getByRole('button', { name: 'Leave pack' })).toBeVisible();
});

test('a pack in a zone this phone can not read still opens, and the developer hears of it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  // Postgres knows this name and Intl doesn't, as with a zone newer than an old phone's list.
  await admin.from('packs').update({ timezone: 'posix/Asia/Jerusalem' }).eq('id', pack.id);
  await signIn(page, noa);

  await page.goto('/');
  await page.getByText('Gym squad').click();
  await expect(page.getByText(/^Day ends in/)).toBeVisible();

  await page.getByRole('link', { name: /Kit/ }).click();
  await expect(page.getByLabel('Noa: 0 fed, 0 rest or joker, 0 paused or asleep, 0 missed')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Leave pack' })).toBeVisible();

  await expect
    .poll(async () => (await admin.from('app_errors').select('message').eq('user_id', noa.id)).data)
    .toEqual([{ message: expect.stringContaining('posix/Asia/Jerusalem') }]);
});

test('leaving a pack ends on the home screen', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
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
  // Noa stays, so the pack goes on without him.
  expect(asked).toEqual(['Leave this pack?']);
});

test('the last member is told before leaving that the pack is deleted', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const left = await dan.client.rpc('leave_pack', { target: pack.id });
  if (left.error) throw left.error;
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/settings`);

  await page.getByRole('button', { name: 'Leave pack' }).click();

  await expect.poll(() => asked).toEqual([expect.stringContaining('Nobody else is in this pack.')]);
  await expect(page.getByRole('button', { name: 'Leave pack' })).toBeVisible();
  const { data: packs } = await noa.client.from('packs').select('id');
  expect(packs).toEqual([{ id: pack.id }]);
});

test('a leave whose answer was lost is done on the second try', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'alert') alerts.push(dialog.message());
    void dialog.accept();
  });
  const socket = await watchSocket(page);
  await signIn(page, dan);
  await page.goto(`/pack/${pack.id}/settings`);
  await expect(page.getByRole('button', { name: 'Leave pack' })).toBeVisible();
  // The connection is gone: the server takes the leave, and neither its answer nor Realtime's word
  // of it reaches the phone.
  socket.away = true;
  await page.route(
    '**/rest/v1/rpc/leave_pack',
    async (route) => {
      await route.fetch();
      await route.abort('connectionfailed');
    },
    { times: 1 },
  );

  await page.getByRole('button', { name: 'Leave pack' }).click();
  await expect.poll(() => alerts).toEqual(["Saving didn't work. Please try again."]);
  const { data: left } = await dan.client.from('packs').select('id');
  expect(left).toEqual([]);

  await page.getByRole('button', { name: 'Leave pack' }).click();

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  expect(alerts).toHaveLength(1);
});

test('joining a pack again after leaving it opens the pack, not its missing screen', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, dan);
  await page.goto(`/pack/${pack.id}/settings`);
  await page.getByRole('button', { name: 'Leave pack' }).click();
  await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
  await page.getByRole('button', { name: 'Join with a code' }).click();
  await page.getByLabel('Invite code').fill(pack.inviteCode);
  await expect(page.getByText('Gym squad')).toBeVisible();
  // Time for a pack screen to say what it holds, before the pack comes back from the server.
  await page.route(/\/rest\/v1\/packs\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });

  await page.getByRole('button', { name: 'Join pack' }).click();

  await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
  expect(await page.getByText("This pack isn't here").isVisible()).toBe(false);
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText("This pack isn't here")).toBeHidden();
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

test('a member who dozed off stays asleep until a pause starts, and through one they cancel', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
  await admin.from('pack_members').update({ status: 'sleeping' }).eq('pack_id', pack.id).eq('user_id', noa.id);
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, noa);

  await page.goto(`/pack/${pack.id}/settings`);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('menuitem', { name: '3 days' }).click();
  await expect(page.getByRole('button', { name: 'Cancel pause' })).toBeVisible();

  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText("One photo and you're back.", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Noa, asleep' })).toBeVisible();
  await expect(page.getByText('0/1 fed today').last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeVisible();

  await page.goto(`/pack/${pack.id}/settings`);
  await page.getByRole('button', { name: 'Cancel pause' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText("One photo and you're back.", { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Noa, asleep' })).toBeVisible();
  await expect(page.getByText('0/1 fed today').last()).toBeVisible();
});

test('a friend leaving a hatched pack leaves the day running for the one who stays', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
  const left = await dan.client.rpc('leave_pack', { target: pack.id });
  if (left.error) throw left.error;
  await signIn(page, noa);

  await page.goto('/');
  await expect(page.getByText('0/1 fed today')).toBeVisible();
  await expect(page.getByText('Waiting for a friend to join.')).toBeHidden();

  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText(/^Day ends in/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite friends' })).toBeVisible();
});

test('an egg left alone goes back to waiting for a friend', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const left = await dan.client.rpc('leave_pack', { target: pack.id });
  if (left.error) throw left.error;
  await signIn(page, noa);

  await page.goto('/');
  await expect(page.getByText('Waiting for a friend to join.')).toBeVisible();

  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByRole('button', { name: 'Invite friends' })).toBeVisible();
  await expect(page.getByText(/^Day ends in/)).toBeHidden();
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

  test("is told so by the pack alone when today's answers can't be read", async ({ page }) => {
    const pack = await pausedPack();
    const today = packDayOf(new Date(), 'Asia/Jerusalem');
    const older = await admin
      .from('pauses')
      .insert({ pack_id: pack.id, user_id: noa.id, starts_on: addDays(today, -90), ends_on: addDays(today, -80) });
    if (older.error) throw older.error;
    await page.route(/\/rest\/v1\/(rpc\/my_day_status|pauses)/, (route) => route.abort());
    await signIn(page, noa);
    const list = page.waitForResponse((response) => response.url().includes('/rest/v1/packs?'));
    await page.goto('/');

    await expect(page.getByLabel('On a pause')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Feed Study buddies' })).toBeHidden();
    const [read] = (await (await list).json()) as { pack_members: { user_id: string; pauses: unknown[] }[] }[];
    expect(read?.pack_members.find((member) => member.user_id === noa.id)?.pauses).toHaveLength(1);

    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText(onPause, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeHidden();
  });

  test('keeps a way to a timer the pause overtook, until it is over', async ({ page }) => {
    const pack = await pausedPack();
    await signIn(page, noa);
    const timer = { packId: pack.id, minutes: null, startedAt: Date.now() - 60_000, pausedAt: null, pausedMs: 0, notificationId: null };
    await page.addInitScript((session) => window.localStorage.setItem('gozali.focus', session), JSON.stringify(timer));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto(`/pack/${pack.id}`);

    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByText(onPause, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeHidden();
  });

  test.describe('with a timer the pause overtook, ended at the camera', () => {
    test.beforeEach(async ({ context, page }) => {
      await context.grantPermissions(['camera']);
      await signIn(page, noa);
    });

    /** A 25-minute timer of the pack that ran out a while ago, as the phone keeps it. */
    const keepTimer = (page: Page, packId: string) =>
      page.addInitScript(
        (session) => window.localStorage.setItem('gozali.focus', session),
        JSON.stringify({ packId, minutes: 25, startedAt: Date.now() - 30 * 60_000, pausedAt: null, pausedMs: 0, notificationId: null }),
      );

    test('by the link at its end, leaves the pack with no timer to open', async ({ page }) => {
      const pack = await pausedPack();
      await keepTimer(page, pack.id);
      await page.goto(`/pack/${pack.id}/feed?focus=25`);

      await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
      await expect(page.getByText(onPause, { exact: false })).toBeVisible();
      expect(await page.evaluate(() => window.localStorage.getItem('gozali.focus'))).toBeNull();
      await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeHidden();
    });

    test('by Done on the timer, leaves the pack with no timer to open', async ({ page }) => {
      const pack = await pausedPack();
      await keepTimer(page, pack.id);
      await page.goto(`/pack/${pack.id}`);
      await page.getByRole('button', { name: 'Focus', exact: true }).click();

      await page.getByRole('button', { name: 'Done, take the photo' }).click();

      await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
      await expect(page.getByText(onPause, { exact: false })).toBeVisible();
      expect(await page.evaluate(() => window.localStorage.getItem('gozali.focus'))).toBeNull();
      await expect(page.getByRole('button', { name: 'Focus', exact: true })).toBeHidden();
    });
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

  test('is asked before End pause ends it for good, and Cancel keeps it', async ({ page }) => {
    const pack = await pausedPack();
    const today = packDayOf(new Date(), 'Asia/Jerusalem');
    // Three days in, the first day a running pause can end.
    await admin.from('pauses').update({ starts_on: addDays(today, -3) }).eq('pack_id', pack.id);
    const asked: string[] = [];
    let yes = false;
    page.on('dialog', (dialog) => {
      asked.push(dialog.message());
      void (yes ? dialog.accept() : dialog.dismiss());
    });
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}/settings`);
    const end = page.getByRole('button', { name: 'End pause' });

    await end.click();
    await expect.poll(() => asked).toEqual([expect.stringContaining('You count again from today')]);
    await expect(end).toBeVisible();
    const kept = await admin.from('pauses').select('ends_on').eq('pack_id', pack.id).single();
    expect(kept.data?.ends_on).toBe(addDays(today, 5));

    yes = true;
    await end.click();
    await expect(page.getByText('Your next pause can start after', { exact: false })).toBeVisible();
    const ended = await admin.from('pauses').select('ends_on').eq('pack_id', pack.id).single();
    expect(ended.data?.ends_on).toBe(addDays(today, -1));
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
