import { expect, test, type Page } from '@playwright/test';

import { admin, createPack, createUser, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
});

test.afterEach(async () => {
  await removeUsers(noa, dan);
});

const POSTS = 35;
const FIRST_PAGE = 30;

const chips = (page: Page) => page.getByRole('button', { name: 'React with 🔥' });

/** A pack with more posts than one page, and its screen at the end of that page. */
async function openAtTheEnd(page: Page) {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  const posts = Array.from({ length: POSTS }, (_, index) => ({
    pack_id: pack.id,
    user_id: dan.id,
    day: '2026-10-01',
    is_extra: true,
    caption: `Post ${index}`,
    created_at: new Date(Date.now() - index * 3_600_000).toISOString(),
  }));
  const posted = await admin.from('feeds').insert(posts);
  if (posted.error) throw posted.error;

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const older = page.getByRole('button', { name: 'Show older' });
  await expect(chips(page)).toHaveCount(FIRST_PAGE);
  // What is left is what a phone does: the browser's own anchoring would hide a lost place.
  await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' });
  await older.scrollIntoViewIfNeeded();
  return older;
}

/** How far down the screen is scrolled. */
const place = (page: Page) =>
  page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((div) => div.scrollHeight > div.clientHeight + 200 && div.innerText.includes('Post 29'));
    return Math.round(scrollers.at(-1)?.scrollTop ?? -1);
  });

/** Holds the longer page until the test lets it through. */
async function holdTheLongerPage(page: Page) {
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/rest\/v1\/feeds\?.*limit=60/, async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

test('Show older keeps the list and the place on the screen while the longer page loads', async ({ page }) => {
  const older = await openAtTheEnd(page);
  const before = await place(page);
  expect(before).toBeGreaterThan(0);
  const release = await holdTheLongerPage(page);

  await older.click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(chips(page)).toHaveCount(FIRST_PAGE);
  expect(await place(page)).toBe(before);

  release();
  await expect(chips(page)).toHaveCount(POSTS);
  expect(await place(page)).toBe(before);
  // All of them are in, so there is nothing older to ask for.
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(older).toHaveCount(0);
});

test('a reaction tapped while the longer page loads ends up on the longer page', async ({ page }) => {
  const older = await openAtTheEnd(page);
  const release = await holdTheLongerPage(page);

  await older.click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await chips(page).nth(FIRST_PAGE - 1).click();

  release();
  await expect(chips(page)).toHaveCount(POSTS);
  await expect(chips(page).nth(FIRST_PAGE - 1)).toContainText('1');
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});
