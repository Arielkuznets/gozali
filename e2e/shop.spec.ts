import { readFileSync } from 'node:fs';

import { expect, test, type Locator } from '@playwright/test';

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

test('the pack buys a cap with its coins and wears it', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'kid', xp: 8, health: 80, coins: 20 }).eq('pack_id', pack.id);

  // The web build asks through the browser's dialogs; answer yes and keep what they said.
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/critter`);
  await expect(page.getByText('20 coins', { exact: true })).toBeVisible();

  // Too expensive: the crown costs 45.
  await page.getByRole('button', { name: 'crown, 45 coins' }).click();
  expect(dialogs.at(-1)).toContain('needs 25 more coins');

  await page.getByRole('button', { name: 'cap, 12 coins' }).click();
  await expect(page.getByText('8 coins', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'cap, 12 coins' })).toBeHidden();

  await page.getByRole('radio', { name: 'cap' }).click();
  await expect
    .poll(async () => (await admin.from('critters').select('outfit').eq('pack_id', pack.id).single()).data?.outfit)
    .toMatchObject({ head: 'cap' });
  const { data: events } = await admin.from('pack_events').select('kind, actor_id, payload').eq('pack_id', pack.id).eq('kind', 'bought');
  expect(events).toEqual([expect.objectContaining({ actor_id: noa.id, payload: expect.objectContaining({ item: 'cap', price: 12 }) })]);
});

test('an item bought before its achievement is in the wardrobe once, and the feed calls nothing new', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'kid', xp: 8, health: 80, coins: 20 }).eq('pack_id', pack.id);
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/critter`);
  await page.getByRole('button', { name: 'beanie, 12 coins' }).click();
  await expect(page.getByText('8 coins', { exact: true })).toBeVisible();

  // A week of good days later, the 7-day streak brings the same beanie, and the feed hears of it.
  const unlocked = await admin.from('achievements').insert({ pack_id: pack.id, key: 'streak_7' });
  if (unlocked.error) throw unlocked.error;

  await page.reload();
  await expect(page.getByRole('radio', { name: 'None' }).first()).toBeVisible();
  await expect(page.getByRole('radio', { name: 'beanie' })).toHaveCount(1);

  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('🏆 Kit unlocked One week strong', { exact: true })).toBeVisible();
});

test('a pet that ran away still shows what each tile offers, and says why the wardrobe waits', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'ran_away', stage: 'kid', xp: 8, health: 0, coins: 20 }).eq('pack_id', pack.id);
  const unlocked = await admin.from('achievements').insert({ pack_id: pack.id, key: 'hatched' });
  if (unlocked.error) throw unlocked.error;

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/critter`);

  // Each drawing names its parts with ids of its own, which say nothing of what it shows.
  const drawing = async (tile: Locator) => (await tile.locator('svg').first().evaluate((svg) => svg.outerHTML)).replace(/gz[a-zA-Z0-9]+/g, 'ID');
  const bow = await drawing(page.getByRole('button', { name: 'bow, 10 coins' }));
  expect(bow).not.toBe(await drawing(page.getByRole('button', { name: 'crown, 45 coins' })));
  expect(await drawing(page.getByRole('radio', { name: 'scarf' }))).not.toBe(await drawing(page.getByRole('radio', { name: 'None' }).last()));
  await expect(page.getByText('The pet is not here right now.', { exact: true })).toBeVisible();
});

test('a profile whose achievements did not load says so, and Try again brings them', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'kid', xp: 8, health: 80, coins: 20 }).eq('pack_id', pack.id);
  const unlocked = await admin.from('achievements').insert({ pack_id: pack.id, key: 'hatched' });
  if (unlocked.error) throw unlocked.error;

  await signIn(page, noa);
  const achievements = /\/rest\/v1\/achievements\?/;
  await page.route(achievements, (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto(`/pack/${pack.id}/critter`);

  // After the app's own tries again.
  await expect(page.getByText("This didn't load. Check the connection and try again.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('🔒')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'scarf, 10 coins' })).toBeHidden();

  await page.unroute(achievements);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('radio', { name: 'scarf' })).toBeVisible();
  await expect(page.getByText('🏆')).toBeVisible();
  await expect(page.getByRole('button', { name: 'scarf, 10 coins' })).toBeHidden();
});

test('the line the pet says when petted shows whole at the top of its profile', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'mochi' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'kid', xp: 8, health: 50 }).eq('pack_id', pack.id);
  const en = JSON.parse(readFileSync(new URL('../apps/mobile/src/i18n/locales/en.json', import.meta.url), 'utf8'));
  const lines = Object.values(en.critter.lines.mochi as Record<string, string[]>).flat();

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/critter`);
  await page.getByRole('button', { name: /^Mochi is / }).click();
  const said = lines.map((line) => page.getByText(line, { exact: true })).reduce((one, other) => one.or(other));
  await expect(said).toBeVisible();

  // The bubble grows up from the pet's head, and the screen's scroller cuts off what is above its top.
  const { bubble, scroller } = await said.evaluate((text) => {
    let box = text.parentElement;
    while (box && !['auto', 'scroll'].includes(getComputedStyle(box).overflowY)) box = box.parentElement;
    return { bubble: text.parentElement!.getBoundingClientRect().top, scroller: box!.getBoundingClientRect().top };
  });
  expect(bubble).toBeGreaterThanOrEqual(scroller);
});

test('an egg has no wardrobe or shop until it hatches', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Solo', habit: 'yoga', species: 'kit' });

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/critter`);
  await expect(page.getByText('The shop opens when the egg hatches', { exact: true })).toBeVisible();
  await expect(page.getByText('Wardrobe', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: 'cap, 12 coins' })).toBeHidden();
});

// An achievement unlocks at its pack's day close, a moment the server sends in UTC.
for (const [zone, unlockedAt, day] of [
  // The close of November 3 in Jerusalem, 21:05 that evening in New York.
  ['America/New_York', '2026-11-04T02:05:00Z', 'Tue, Nov 3'],
  // The close of June 15 in Tokyo, 04:00 the next morning there.
  ['Asia/Tokyo', '2027-06-15T19:00:00Z', 'Wed, Jun 16'],
] as const) {
  test.describe(`a phone in ${zone}`, () => {
    test.use({ timezoneId: zone });

    test('dates an achievement by the day it was on the phone', async ({ page }) => {
      const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
      await admin.from('critters').update({ status: 'active', stage: 'kid', xp: 8, health: 80 }).eq('pack_id', pack.id);
      const unlocked = await admin.from('achievements').insert({ pack_id: pack.id, key: 'streak_7', unlocked_at: unlockedAt });
      if (unlocked.error) throw unlocked.error;

      await signIn(page, noa);
      await page.goto(`/pack/${pack.id}/critter`);
      await expect(page.getByText('One week strong', { exact: true })).toBeVisible();
      await expect(page.getByText(day, { exact: true })).toBeVisible();
    });
  });
}
