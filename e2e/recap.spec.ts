import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from './support';

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

/** Last week's recap, with every photo of the pack in its collage. */
async function recapOf(packId: string): Promise<void> {
  const { data: posted } = await admin.from('feeds').select('id').eq('pack_id', packId).order('created_at');
  const { error } = await admin.from('weekly_recaps').insert({
    pack_id: packId,
    week_start: '2026-10-18',
    feed_ids: (posted ?? []).map((row) => row.id as string),
    stats: {
      weekStart: '2026-10-18',
      weekEnd: '2026-10-24',
      days: 7,
      successDays: 6,
      healthStart: 70,
      healthEnd: 85,
      topMembers: [noa.id],
      topFeeds: 6,
      achievements: [],
      critter: { species: 'axo', stage: 'kid', status: 'active', health: 85, marks: [], outfit: {}, name: 'Pico', streak: 7 },
    },
  });
  if (error) throw error;
}

// The story is drawn off screen to be captured, and a screen reader would read it after the recap.
test('a screen reader reads the recap once, without the story behind it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan]);
  await feed(noa, pack.id, await photo(page, '🏋️'), 'Leg day');
  await recapOf(pack.id);

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/recap`);
  await expect(page.getByLabel('Photo from Noa')).toBeVisible();

  const read = await page.locator('body').ariaSnapshot();
  expect(read.match(/good days/g)).toHaveLength(1);
  expect(read).not.toContain('gozali.app');
});

test.describe('on a phone 360 wide', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('the collage keeps three photos to a row', async ({ page }) => {
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'axo' }, [dan, maya]);
    for (const member of [noa, dan, maya]) await feed(member, pack.id, await photo(page, '🏋️'), 'Leg day');
    await recapOf(pack.id);

    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}/recap`);
    const tiles = page.getByLabel(/^Photo from /);
    await expect(tiles).toHaveCount(3);

    const tops = await Promise.all((await tiles.all()).map(async (tile) => Math.round((await tile.boundingBox())!.y)));
    expect(new Set(tops).size).toBe(1);
  });
});
