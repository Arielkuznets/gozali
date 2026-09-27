import { expect, test } from '@playwright/test';

import { createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
});

test.afterEach(async () => {
  await removeUsers(noa, dan);
});

test('reactions show at once, and a friend\'s arrives without a reload', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' }, [dan]);
  await feed(dan, pack.id, await photo(page, '🏋️'), 'Leg day');
  const { data: posted } = await dan.client.from('feeds').select('id').eq('pack_id', pack.id).single();

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const fire = page.getByRole('button', { name: 'React with 🔥' });
  await expect(page.getByText('Leg day')).toBeVisible();

  // Noa's own reaction counts right away.
  await fire.click();
  await expect(fire).toContainText('1');

  // Dan reacts from his phone; Noa's screen follows through realtime.
  const clap = page.getByRole('button', { name: 'React with 👏' });
  await expect(clap).not.toContainText('1');
  const reacted = await dan.client.rpc('react', { target_feed: posted!.id, emoji: 'clap' });
  expect(reacted.error).toBeNull();
  await expect(clap).toContainText('1', { timeout: 15_000 });
  await expect(page.getByText('Noa, Dan').or(page.getByText('Dan, Noa'))).toBeVisible();

  // Taking it back.
  await fire.click();
  await expect(fire).not.toContainText('1');
});
