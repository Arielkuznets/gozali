import { expect, test, type Page } from '@playwright/test';

import { admin, createPack, createUser, feed, layOutTextLikeAPhone, photo, removeUsers, signIn, type TestUser } from './support';

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

test('members nudge, report and block from the pack screen', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan, maya]);
  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 70 }).eq('pack_id', pack.id);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');

  const dialogs = answerDialogs(page);
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);

  // Maya hasn't fed: a tap on her circle nudges her.
  await page.getByRole('button', { name: 'Maya, not yet today' }).click();
  await expect.poll(() => dialogs.at(-1)).toBe('Sent!');
  expect(dialogs.at(-2)).toContain('Nudge Maya?');
  const { data: nudges } = await admin.from('nudges').select('from_user, to_user').eq('pack_id', pack.id);
  expect(nudges).toEqual([{ from_user: noa.id, to_user: maya.id }]);

  // Dan's photo has a menu with every choice.
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Report photo', 'Block Dan']);
  await page.getByRole('menuitem', { name: 'Report photo' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('We will look at it');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  const { data: reports } = await admin.from('reports').select('reporter_id');
  expect(reports).toContainEqual({ reporter_id: noa.id });

  // A long press on a member opens their whole menu, even when a tap would nudge.
  await page.getByRole('button', { name: 'Maya, not yet today' }).click({ delay: 900 });
  await expect(page.getByRole('menuitem')).toHaveText(['Nudge', 'Block Maya']);
  await page.getByRole('menuitem', { name: 'Block Maya' }).click();
  await expect.poll(() => dialogs.at(-1)).toContain('Blocked.');
  const { data: blocks } = await admin.from('blocks').select('blocked_id').eq('blocker_id', noa.id);
  expect(blocks).toEqual([{ blocked_id: maya.id }]);
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
  await expect(page.getByRole('menuitem')).toHaveText(['Report photo', 'Block Bartholomew Montgomery-Smithso']);
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
