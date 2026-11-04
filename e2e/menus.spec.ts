import { expect, test, type Page } from '@playwright/test';

import {
  admin,
  createPack,
  createSignedUpUser,
  createUser,
  feed,
  layOutTextLikeAPhone,
  photo,
  removeUsers,
  setClock,
  signIn,
  signInElsewhere,
  type TestUser,
} from './support';

let noa: TestUser;
let dan: TestUser;
let maya: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
  maya = await createUser('Maya');
});

test.afterEach(async () => {
  await removeUsers(noa, dan, maya);
});

/** The web build asks through the browser's dialogs; answer yes and keep what they said. */
function answerDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  return dialogs;
}

/** Text at twice its size, about what the largest accessibility settings of a phone give. */
async function doubleTheText(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('div[dir=auto]').forEach((text) => {
      const { fontSize, lineHeight } = getComputedStyle(text);
      text.style.fontSize = `${parseFloat(fontSize) * 2}px`;
      text.style.lineHeight = `${parseFloat(lineHeight) * 2}px`;
    });
  });
}

test('members nudge, report and block from the pack screen', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan, maya]);
  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  await setClock(maya, 12);

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);

  // Noa's own circle tells how she stands, and is no button: it has no menu.
  await expect(page.getByLabel('Noa, not yet today')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Noa, not yet today' })).toHaveCount(0);

  // Maya hasn't fed: a tap on her circle nudges her.
  await page.getByRole('button', { name: 'Maya, not yet today' }).click();
  await expect.poll(() => dialogs.at(-1)).toBe('Sent!');
  expect(dialogs.at(-2)).toContain('Nudge Maya?');
  const { data: nudges } = await admin.from('nudges').select('from_user, to_user').eq('pack_id', pack.id);
  expect(nudges).toEqual([{ from_user: noa.id, to_user: maya.id }]);

  // Dan's photo has a menu with every choice.
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Report photo', 'Report Dan', 'Block Dan']);
  await page.getByRole('menuitem', { name: 'Report photo' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  const { data: reports } = await admin.from('reports').select('reporter_id');
  expect(reports).toContainEqual({ reporter_id: noa.id });

  // A long press on a member opens their whole menu, even when a tap would nudge.
  await page.getByRole('button', { name: 'Maya, not yet today' }).click({ delay: 900 });
  await expect(page.getByRole('menuitem')).toHaveText(['Nudge', 'Report Maya', 'Block Maya']);
  await page.getByRole('menuitem', { name: 'Block Maya' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');
  // A block hides Maya from Noa, not Noa from Maya, and her 🤨 still counts: the question says both,
  // and the answer names the ways out of her sight.
  expect(dialogs.at(-2)).toContain('A 🤨 of theirs still counts in the 🤨 number, which names nobody.');
  expect(dialogs.at(-2)).toContain('They can still see what you post in a pack you share.');
  expect(dialogs.at(-1)).toContain('leave this pack from its settings, where its admin can remove them');
  const { data: blocks } = await admin.from('blocks').select('blocked_id').eq('blocker_id', noa.id);
  expect(blocks).toEqual([{ blocked_id: maya.id }]);
});

test("a nudge during the night on their clock says so and doesn't use up the day's nudge", async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [maya]);
  await setClock(maya, 23);

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('button', { name: 'Maya, not yet today' }).click();

  await expect.poll(() => dialogs.at(-1)).toBe("It's night for them. Try after 07:00 their time.");
  expect(dialogs.at(-2)).toContain('Nudge Maya?');
  const { data: nudges } = await admin.from('nudges').select('to_user').eq('pack_id', pack.id);
  expect(nudges).toEqual([]);
});

test('a member reported from their menu reaches the developer', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);

  await page.getByRole('button', { name: 'Dan, not yet today' }).click({ delay: 900 });
  await page.getByRole('menuitem', { name: 'Report Dan' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  expect(dialogs.at(-2)).toContain('Report Dan?');
  // The bullying the Terms forbid is something to report a member for too.
  expect(dialogs.at(-2)).toContain('how they treat you');
  const { data: reports } = await admin.from('reports').select('feed_id, member_id, reporter_id').eq('reporter_id', noa.id);
  expect(reports).toEqual([{ feed_id: null, member_id: dan.id, reporter_id: noa.id }]);
});

test('a member removed from the pack is reported from a post they left behind', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  const removed = await noa.client.rpc('remove_member', { target: pack.id, member: dan.id });
  if (removed.error) throw removed.error;

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  // Out of the pack, Dan has no circle to press.
  await expect(page.getByText('Leg day')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Dan, / })).toHaveCount(0);

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Report Dan' }).click();

  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  expect(dialogs.at(-2)).toContain('Report Dan?');
  const { data: reports } = await admin.from('reports').select('feed_id, member_id, reporter_id').eq('reporter_id', noa.id);
  expect(reports).toEqual([{ feed_id: null, member_id: dan.id, reporter_id: noa.id }]);
});

test('a photo that reports just hid can still be reported from a screen that shows it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('button', { name: 'More' }).click();
  const hidden = await admin.from('feeds').update({ hidden_at: new Date().toISOString() }).eq('pack_id', pack.id).select('id').single();
  await page.getByRole('menuitem', { name: 'Report photo' }).click();

  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  const { data: reports } = await admin.from('reports').select('feed_id, reporter_id').eq('reporter_id', noa.id);
  expect(reports).toEqual([{ feed_id: hidden.data!.id, reporter_id: noa.id }]);
});

test('the menu of a photo stays on the screen beside a long name', async ({ page }) => {
  await dan.client.from('profiles').update({ display_name: 'Bartholomew Montgomery-Smithso' }).eq('id', dan.id);
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  // A photo from another day shows the date as well as the time.
  await admin.from('feeds').update({ created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() }).eq('pack_id', pack.id);

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const more = page.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  await layOutTextLikeAPhone(page);

  // Read without scrolling: anything that scrolled to the button could carry it in sideways.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = (await more.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }

  await more.click();
  await expect(page.getByRole('menuitem')).toHaveText(['Report photo', 'Report Bartholomew Montgomery-Smithso', 'Block Bartholomew Montgomery-Smithso']);
});

test('a photo keeps its name and its menu at the largest text', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  // An extra from another day shows the longest time a photo has.
  await admin
    .from('feeds')
    .update({ is_extra: true, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() })
    .eq('pack_id', pack.id);

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const more = page.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  await layOutTextLikeAPhone(page);
  await doubleTheText(page);

  const meta = more.locator('../..');
  const name = meta.locator('> div').first();
  await expect(name).toHaveText('Dan');
  for (const width of [390, 375, 360]) {
    await page.setViewportSize({ width, height: 844 });
    const nameBox = (await name.boundingBox())!;
    const moreBox = (await more.boundingBox())!;
    const cardBox = (await meta.locator('..').boundingBox())!;
    expect.soft(nameBox.width, `the name at ${width}`).toBeGreaterThan(50);
    expect.soft(moreBox.x + moreBox.width, `the menu at ${width}`).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  }
});

test('a photo on the whole screen has the same menu', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  const { data: posted } = await admin.from('feeds').select('id').eq('pack_id', pack.id).single();

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('img', { name: 'Leg day' }).click();
  const viewer = page.getByRole('dialog');

  await viewer.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Report photo', 'Report Dan', 'Block Dan']);
  await page.getByRole('menuitem', { name: 'Report photo' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  const { data: reports } = await admin.from('reports').select('feed_id, reporter_id').eq('reporter_id', noa.id);
  expect(reports).toEqual([{ feed_id: posted!.id, reporter_id: noa.id }]);

  // A report leaves the photo open; once its poster is blocked it is out of sight.
  await viewer.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Block Dan' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');
  await expect(page.getByRole('button', { name: 'Close photo' })).toBeHidden();
  await expect(page.getByText('Leg day')).toBeHidden();
  const { data: blocks } = await admin.from('blocks').select('blocked_id').eq('blocker_id', noa.id);
  expect(blocks).toEqual([{ blocked_id: dan.id }]);
});

test('the buttons of a photo on the whole screen stay beside a long name', async ({ page }) => {
  await dan.client.from('profiles').update({ display_name: 'Bartholomew Montgomery-Smithso' }).eq('id', dan.id);
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('img', { name: 'Leg day' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer.getByRole('button', { name: 'More' })).toBeVisible();
  await layOutTextLikeAPhone(page);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(viewer.getByRole('button', { name: 'More' })).toBeInViewport({ ratio: 1 });
    await expect(viewer.getByRole('button', { name: 'Close photo' })).toBeInViewport({ ratio: 1 });
  }
});

test('your own photo on the whole screen has no menu', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' });
  await feed(noa, pack.id, await photo(page, '🏋️'), 'Leg day');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('img', { name: 'Leg day' }).click();
  await expect(page.getByRole('button', { name: 'Close photo' })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'More' })).toHaveCount(0);
});

/** A recap of a week the member led, with the pack's photos in its collage. Returns the photos' ids. */
async function recapOf(packId: string, top: TestUser): Promise<string[]> {
  const { data: posted } = await admin.from('feeds').select('id').eq('pack_id', packId);
  const feedIds = (posted ?? []).map((row) => row.id as string);
  const { error } = await admin.from('weekly_recaps').insert({
    pack_id: packId,
    week_start: '2026-10-18',
    feed_ids: feedIds,
    stats: {
      weekStart: '2026-10-18',
      weekEnd: '2026-10-24',
      days: 7,
      successDays: 6,
      healthStart: 70,
      healthEnd: 85,
      coins: 9,
      topMembers: [top.id],
      topFeeds: 6,
      achievements: [],
      critter: { species: 'axo', stage: 'kid', status: 'active', health: 85, marks: [], outfit: {}, name: 'Pico', streak: 7 },
    },
  });
  if (error) throw error;
  return feedIds;
}

test('a recap photo can be reported and its poster blocked', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  const [posted] = await recapOf(pack.id, dan);

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/recap`);
  await page.getByLabel('Photo from Dan').click();

  const viewer = page.getByRole('dialog');
  await viewer.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Report photo', 'Report Dan', 'Block Dan']);
  await page.getByRole('menuitem', { name: 'Report photo' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  const { data: reports } = await admin.from('reports').select('feed_id, reporter_id').eq('reporter_id', noa.id);
  expect(reports).toEqual([{ feed_id: posted, reporter_id: noa.id }]);

  await viewer.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Block Dan' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');
  await expect(page.getByRole('button', { name: 'Close photo' })).toBeHidden();
  await expect(page.getByLabel('Photo from Dan')).toBeHidden();
});

test.describe('a photo past its 30 days', () => {
  async function postAndExpire(page: Page, caption: string) {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
    await feed(dan, pack.id, await photo(page, '🏋️'), caption);
    const { data: posted } = await admin.from('feeds').update({ photo_path: null }).eq('pack_id', pack.id).select('id').single();
    return { pack, feedId: posted!.id as string };
  }

  test('says why it is gone, and leaves its caption to report', async ({ page }) => {
    const { pack, feedId } = await postAndExpire(page, 'Leg day');

    const dialogs = answerDialogs(page);
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText('Photos are kept for 30 days.')).toBeVisible();
    await expect(page.getByText('Leg day')).toBeVisible();

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Report caption', 'Report Dan', 'Block Dan']);
    await page.getByRole('menuitem', { name: 'Report caption' }).click();
    await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
    expect(dialogs.at(-2)).toContain('Report this caption?');
    const { data: reports } = await admin.from('reports').select('feed_id, reporter_id').eq('reporter_id', noa.id);
    expect(reports).toEqual([{ feed_id: feedId, reporter_id: noa.id }]);
  });

  test('with no caption leaves only its poster to report', async ({ page }) => {
    const { pack } = await postAndExpire(page, '');

    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText('Photos are kept for 30 days.')).toBeVisible();

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Report Dan', 'Block Dan']);
  });
});

/** Gives the member a profile photo the way the app does. */
async function setAvatar(member: TestUser, picture: Buffer): Promise<void> {
  const path = `${member.id}/me.jpg`;
  const upload = await member.client.storage.from('avatars').upload(path, picture, { contentType: 'image/jpeg' });
  if (upload.error) throw upload.error;
  const saved = await member.client.from('profiles').update({ avatar_path: path }).eq('id', member.id);
  if (saved.error) throw saved.error;
}

test('blocking a member takes their profile photo off the screen', async ({ page }) => {
  const picture = await photo(page, '🙂');
  await setAvatar(dan, picture);
  await setAvatar(maya, picture);
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan, maya]);

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const dansPhoto = page.locator(`img[src*="/avatars/${dan.id}/"]`);
  const mayasPhoto = page.locator(`img[src*="/avatars/${maya.id}/"]`);
  await expect(dansPhoto).toHaveCount(1);
  await expect(mayasPhoto).toHaveCount(1);

  await page.getByRole('button', { name: 'Maya, not yet today' }).click({ delay: 900 });
  await page.getByRole('menuitem', { name: 'Block Maya' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');
  await expect(mayasPhoto).toHaveCount(0);
  await expect(dansPhoto).toHaveCount(1);

  // Links asked for afterwards leave out the blocked member and still reach everyone else.
  await page.reload();
  await expect(dansPhoto).toHaveCount(1);
  await expect(mayasPhoto).toHaveCount(0);
});

test('unblocking brings the profile photo back', async ({ page }) => {
  await setAvatar(maya, await photo(page, '🙂'));
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [maya]);
  const blocked = await noa.client.from('blocks').insert({ blocker_id: noa.id, blocked_id: maya.id });
  if (blocked.error) throw blocked.error;

  // All in one visit, so the links signed during the block are still in memory.
  await signIn(page, noa);
  await page.goto('/');
  const links = page.waitForResponse((response) => response.url().includes('/object/sign/avatars'));
  await page.getByText('Gym squad').click();
  await links;
  const mayasPhoto = page.locator(`img[src*="/avatars/${maya.id}/"]`);
  await expect(page.getByRole('button', { name: 'Maya, not yet today' })).toBeVisible();
  await expect(mayasPhoto).toHaveCount(0);

  await page.goBack();
  await page.getByRole('button', { name: 'Me' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Unblock' }).click();
  await expect(page.getByText("You haven't blocked anyone.")).toBeVisible();
  await page.goBack();
  await page.goBack();
  await page.getByText('Gym squad').click();
  await expect(mayasPhoto).toHaveCount(1);
});

test('a member you block stays fed on every screen', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan, maya]);
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'Arms');
  await feed(dan, pack.id, image, 'Leg day');

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const dansCircle = page.getByRole('button', { name: 'Dan, fed today' });
  // Home stays in the page under the pack screen, with a count of its own.
  const fedCount = page.getByText('2/3 fed today').last();
  await expect(dansCircle).toBeVisible();
  await expect(fedCount).toBeVisible();
  await expect(page.getByText('Leg day')).toBeVisible();

  await dansCircle.click();
  await expect(page.getByRole('menuitem')).toHaveText(['Report Dan', 'Block Dan']);
  await page.getByRole('menuitem', { name: 'Block Dan' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');
  await expect(page.getByText('Leg day')).toBeHidden();

  // What goes is the photo: the day still counts Dan, as the day close will.
  await page.reload();
  await expect(dansCircle).toBeVisible();
  await expect(fedCount).toBeVisible();
  await expect(page.getByText('Two of you fed today')).toBeVisible();
  await expect(page.getByText('Leg day')).toBeHidden();

  await page.goto('/');
  await expect(fedCount).toBeVisible();
  await page.goto(`/pack/${pack.id}/critter`);
  await expect(page.getByLabel('Dan: 1 fed, 0 rest or joker, 0 paused or asleep, 0 missed')).toBeVisible();
});

test('a member you block still shows joining the pack', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  const blocked = await noa.client.from('blocks').insert({ blocker_id: noa.id, blocked_id: dan.id });
  if (blocked.error) throw blocked.error;

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByRole('button', { name: 'Dan, fed today' })).toBeVisible();
  // A block hides what they post, not that they are in the pack and can read what Noa posts there.
  await expect(page.getByText('👋 Dan joined the pack')).toBeVisible();
  await expect(page.getByText('Leg day')).toBeHidden();
  await expect(page.getByText('No feeds yet. Be the first today!')).toBeHidden();
});

test.describe('a block whose reads afterwards fail', () => {
  // As on a connection that drops right after the block went out.
  const readsFail = (page: Page) =>
    page.route('**/rest/v1/**', (route) => (route.request().method() === 'GET' ? route.abort('internetdisconnected') : route.continue()));

  test("takes the member's posts, lines and profile photo off the pack", async ({ page }) => {
    const image = await photo(page, '🏋️');
    await setAvatar(dan, await photo(page, '🙂'));
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
    await admin.from('critters').update({ status: 'active', stage: 'kid', xp: 8, health: 80, coins: 20 }).eq('pack_id', pack.id);
    const bought = await dan.client.rpc('buy_item', { target: pack.id, wanted: 'cap' });
    if (bought.error) throw bought.error;
    await feed(dan, pack.id, image, 'Leg day');

    const dialogs = answerDialogs(page);
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    const dansPhoto = page.locator(`img[src*="/avatars/${dan.id}/"]`);
    await expect(page.getByText('Leg day')).toBeVisible();
    await expect(page.getByText('🛍️ Dan bought Axo a cap')).toBeVisible();
    await expect(dansPhoto).toHaveCount(1);

    await readsFail(page);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Block Dan' }).click();
    await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');

    await expect(page.getByText('Leg day')).toBeHidden();
    await expect(page.getByText('🛍️ Dan bought Axo a cap')).toBeHidden();
    await expect(dansPhoto).toHaveCount(0);
    // A join isn't content, and who fed doesn't change.
    await expect(page.getByText('👋 Dan joined the pack')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dan, fed today' })).toBeVisible();
  });

  test("takes the member's photos out of a recap", async ({ page }) => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
    await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
    await recapOf(pack.id, dan);

    const dialogs = answerDialogs(page);
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}/recap`);
    await page.getByLabel('Photo from Dan').click();

    await readsFail(page);
    await page.getByRole('dialog').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Block Dan' }).click();
    await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');

    await expect(page.getByRole('button', { name: 'Close photo' })).toBeHidden();
    await expect(page.getByLabel('Photo from Dan')).toBeHidden();
  });

  test("takes the member's name suggestions off the open card", async ({ page }) => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
    await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
    for (const [member, name] of [
      [dan, 'Biscuit'],
      [noa, 'Mochi'],
    ] as const) {
      const suggested = await member.client.rpc('suggest_name', { target: pack.id, suggested: name });
      if (suggested.error) throw suggested.error;
    }

    const dialogs = answerDialogs(page);
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText('by Dan', { exact: true })).toBeVisible();

    await readsFail(page);
    await page.getByRole('button', { name: 'Dan, not yet today' }).click({ delay: 900 });
    await page.getByRole('menuitem', { name: 'Block Dan' }).click();
    await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');

    await expect(page.getByText('Biscuit', { exact: true })).toBeHidden();
    await expect(page.getByText('by Dan', { exact: true })).toBeHidden();
    await expect(page.getByText('Mochi', { exact: true })).toBeVisible();
  });
});

test('a photo hidden by reports still counts for the day', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  const hidden = await admin.from('feeds').update({ hidden_at: new Date().toISOString() }).eq('pack_id', pack.id);
  if (hidden.error) throw hidden.error;

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByRole('button', { name: 'Dan, fed today' })).toBeVisible();
  await expect(page.getByText('1/2 fed today').last()).toBeVisible();
  await expect(page.getByText('Leg day')).toBeHidden();

  // Its author isn't asked to feed again today.
  await signIn(page, dan);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('Your part is done for today ✓')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Post another photo' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByLabel('Fed today')).toBeVisible();
});

test.describe('an empty pack feed', () => {
  const NOBODY_FED = 'No feeds yet. Be the first today!';
  const OUT_OF_SIGHT = 'Nothing to show here yet.';

  test('asks to be first while nobody fed', async ({ page }) => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' });

    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText(NOBODY_FED)).toBeVisible();
    await expect(page.getByText(OUT_OF_SIGHT)).toBeHidden();
  });

  test('does not ask someone whose own post reports hid', async ({ page }) => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' });
    await feed(noa, pack.id, await photo(page, '🏋️'), 'Leg day');
    const hidden = await admin.from('feeds').update({ hidden_at: new Date().toISOString() }).eq('pack_id', pack.id);
    if (hidden.error) throw hidden.error;

    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await expect(page.getByText('Your part is done for today ✓')).toBeVisible();
    await expect(page.getByText(OUT_OF_SIGHT)).toBeVisible();
    await expect(page.getByText(NOBODY_FED)).toBeHidden();
  });
});

test('a nudge refused because they fed brings the circle up to date', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  const image = await photo(page, '🏋️');
  const blocked = await noa.client.from('blocks').insert({ blocker_id: noa.id, blocked_id: dan.id });
  if (blocked.error) throw blocked.error;

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const waiting = page.getByRole('button', { name: 'Dan, not yet today' });
  await expect(waiting).toBeVisible();

  // Realtime keeps to the same policy as the table, so this feed doesn't reach the open screen.
  await feed(dan, pack.id, image, 'Leg day');
  await waiting.click();
  await expect.poll(() => dialogs.at(-1)).toBe('They already fed today.');
  await expect(page.getByRole('button', { name: 'Dan, fed today' })).toBeVisible();
  await expect(page.getByText('1/2 fed today').last()).toBeVisible();
});

test('the profile photo menu adds and removes a photo', async ({ page }) => {
  const picture = await photo(page, '🙂');
  answerDialogs(page);
  await signIn(page, noa);
  await page.goto('/me');

  await page.getByRole('button', { name: 'Profile photo' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Take a photo', 'Choose from library']);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Choose from library' }).click();
  await (await chooser).setFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: picture });
  await expect(page.getByText('Change photo')).toBeVisible();

  // With a photo there are three choices, which Android's own alert couldn't all show.
  await page.getByRole('button', { name: 'Profile photo' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Take a photo', 'Choose from library', 'Remove photo']);
  await page.getByRole('menuitem', { name: 'Remove photo' }).click();
  await expect(page.getByText('Add a photo')).toBeVisible();
  const { data: profile } = await admin.from('profiles').select('avatar_path').eq('id', noa.id).single();
  expect(profile?.avatar_path).toBeNull();
});

/** Picks a profile photo from the library, through the menu of the photo on the screen. */
async function choosePhoto(page: Page, picture: Buffer): Promise<void> {
  await page.getByRole('button', { name: 'Profile photo' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('menuitem', { name: 'Choose from library' }).click();
  await (await chooser).setFiles({ name: 'me.jpg', mimeType: 'image/jpeg', buffer: picture });
}

const photoFiles = async (member: TestUser) => ((await admin.storage.from('avatars').list(member.id)).data ?? []).map((file) => file.name);

test('removing the photo on a phone that missed a change removes the photo in use', async ({ browser, page }) => {
  const first = await photo(page, '🙂');
  const second = await photo(page, '😎');
  answerDialogs(page);
  await signIn(page, noa);
  await page.goto('/me');
  await choosePhoto(page, first);
  await expect.poll(() => photoFiles(noa)).toHaveLength(1);
  const before = await photoFiles(noa);

  // The same account on a second phone, which read the profile before the change and hears nothing of it.
  const { data } = await (await signInElsewhere(noa)).auth.getSession();
  const secondPhone = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await secondPhone.newPage();
  answerDialogs(other);
  await signIn(other, { ...noa, session: data.session! });
  await other.goto('/me');
  await expect(other.getByText('Change photo')).toBeVisible();

  await choosePhoto(page, second);
  await expect.poll(() => photoFiles(noa)).not.toEqual(before);
  await expect.poll(() => photoFiles(noa)).toHaveLength(1);

  await other.getByRole('button', { name: 'Profile photo' }).click();
  await other.getByRole('menuitem', { name: 'Remove photo' }).click();
  await expect(other.getByText('Add a photo')).toBeVisible();

  await expect.poll(() => photoFiles(noa)).toEqual([]);
  const { data: profile } = await admin.from('profiles').select('avatar_path').eq('id', noa.id).single();
  expect(profile?.avatar_path).toBeNull();
  await secondPhone.close();
});

test('a profile photo shows that it is uploading, and the button waits for it', async ({ page }) => {
  const picture = await photo(page, '🙂');
  answerDialogs(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/storage/v1/object/avatars/**', async (route) => {
    if (route.request().method() === 'POST') await held;
    await route.continue();
  });
  await signIn(page, noa);
  await page.goto('/me');
  await choosePhoto(page, picture);

  const button = page.getByRole('button', { name: 'Profile photo' });
  await expect(button.getByRole('progressbar')).toBeVisible();
  await expect(button).toBeDisabled();
  await button.click({ force: true });
  await expect(page.getByRole('menuitem')).toHaveCount(0);

  release();
  await expect(page.getByText('Change photo')).toBeVisible();
  await expect(button.getByRole('progressbar')).toBeHidden();
  expect(await photoFiles(noa)).toHaveLength(1);
});

test.describe('someone on the profile setup', () => {
  let eve: TestUser;

  test.beforeEach(async () => {
    eve = await createSignedUpUser('Eve');
  });

  test.afterEach(async () => {
    await removeUsers(eve);
  });

  test('hears of a profile photo that fails after the setup is done', async ({ page }) => {
    const picture = await photo(page, '🙂');
    const dialogs = answerDialogs(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/storage/v1/object/avatars/**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await held;
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"statusCode":"500","error":"Internal","message":"boom"}' });
    });
    await signIn(page, eve);
    await page.goto('/');
    await expect(page.getByText('About you')).toBeVisible();

    await choosePhoto(page, picture);
    await page.getByPlaceholder('What do your friends call you?').fill('Eve');
    await page.getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: 'Create a pack' })).toBeVisible();
    release();

    await expect.poll(() => dialogs).toContain("Saving didn't work. Please try again.");
  });
});
