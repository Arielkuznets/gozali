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

test('feeding: camera, caption, send, and the photo shows in the pack', async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'mochi' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'kid', health: 64, xp: 9 }).eq('pack_id', pack.id);
  await feed(dan, pack.id, await photo(page, '📚'), 'Finished the problem set');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('Finished the problem set')).toBeVisible();
  await page.getByRole('button', { name: 'Feed', exact: true }).click();

  await page.getByRole('button', { name: 'Take photo' }).click();
  await page.getByPlaceholder('Add a caption (optional)').fill('Chapter 4, done');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Mochi loved it!')).toBeVisible();

  // The screen closes by itself and the new photo is in the pack feed.
  await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
  await expect(page.getByText('Chapter 4, done')).toBeVisible();
  const { data: feeds } = await noa.client.from('feeds').select('caption, is_extra').eq('user_id', noa.id);
  expect(feeds).toEqual([{ caption: 'Chapter 4, done', is_extra: false }]);

  // Dan's photo opens on the whole screen and closes again.
  await page.getByRole('img', { name: 'Finished the problem set' }).first().click();
  await expect(page.getByRole('button', { name: 'Close photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Close photo' }).click();
  await expect(page.getByRole('button', { name: 'Close photo' })).toBeHidden();
});
