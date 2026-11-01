// What a phone misses while it is away. A suspended app's socket is gone and Realtime replays
// nothing, so whatever was sent meanwhile has to come from a fetch. Here the frames are dropped on
// their way to the page; the socket itself stays up, because closing it isn't what a phone does.
import { expect, test, type Page } from '@playwright/test';

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

/** Carries the socket's frames to the page, until `away` is set. */
async function watchSocket(page: Page) {
  const socket = { away: false, subscriptions: 0 };
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (String(message).includes('Subscribed to PostgreSQL')) socket.subscriptions += 1;
      if (!socket.away) ws.send(message);
    });
  });
  return socket;
}

/** Waits for the app to be listening, so a later silence isn't down to a channel still joining. */
async function listening(socket: { subscriptions: number }) {
  await expect.poll(() => socket.subscriptions, { timeout: 30_000 }).toBeGreaterThan(0);
}

/** What TanStack Query hears when the app comes back; on a phone lib/appFocus.ts says the same. */
const comeBack = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));

test("a friend's photo from while the app was away shows on coming back to the pack", async ({ page }) => {
  const socket = await watchSocket(page);
  const pack = await createPack(noa, { name: 'Away', habit: 'gym', species: 'kit' }, [dan]);
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'noa first');
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('noa first')).toBeVisible();
  await expect(page.getByText('1/2 fed today').last()).toBeVisible();
  await listening(socket);

  socket.away = true;
  await feed(dan, pack.id, image, 'dan while away');
  await page.waitForTimeout(1500);
  socket.away = false;
  await comeBack(page);

  await expect(page.getByText('2/2 fed today').last()).toBeVisible();
  await expect(page.getByText('dan while away')).toBeVisible();
});

test("a friend's photo from while the app was away shows on opening the pack again", async ({ page }) => {
  const socket = await watchSocket(page);
  const pack = await createPack(noa, { name: 'Reopen', habit: 'gym', species: 'kit' }, [dan]);
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'noa first');
  await signIn(page, noa);
  await page.goto('/');
  await page.getByText('Reopen').first().click();
  await expect(page.getByText('noa first')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(page.getByText('Your packs')).toBeVisible();
  await listening(socket);

  socket.away = true;
  await feed(dan, pack.id, image, 'dan while away');
  await page.waitForTimeout(1500);
  socket.away = false;
  await comeBack(page);
  await expect(page.getByText('2/2 fed today').first()).toBeVisible();

  // As a tap on the push does.
  await page.getByText('Reopen').first().click();
  await expect(page.getByText('dan while away')).toBeVisible();
});

test('a reaction a friend took back goes on coming back to the pack', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Take back', habit: 'gym', species: 'kit' }, [dan]);
  await feed(noa, pack.id, await photo(page, '🏋️'), 'noa first');
  const { data: posted } = await admin.from('feeds').select('id').eq('pack_id', pack.id).single();
  await dan.client.rpc('react', { target_feed: posted!.id, emoji: 'suspicious' });
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const suspicious = page.getByRole('button', { name: 'React with 🤨' });
  await expect(suspicious).toContainText('1');

  // Realtime sends no deletes (decision D23), so nothing arrives until a fetch.
  await dan.client.rpc('react', { target_feed: posted!.id, emoji: null });
  await comeBack(page);

  await expect(suspicious).not.toContainText('1');
});

test("a reaction to a friend's new photo doesn't keep that photo from the pack", async ({ page }) => {
  const socket = await watchSocket(page);
  const pack = await createPack(noa, { name: 'Reacted', habit: 'gym', species: 'kit' }, [dan]);
  const image = await photo(page, '🏋️');
  await feed(noa, pack.id, image, 'noa first');
  await signIn(page, noa);
  await page.goto('/');
  await page.getByText('Reacted').first().click();
  await expect(page.getByText('noa first')).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(page.getByText('Your packs')).toBeVisible();
  await listening(socket);

  // The cached page of the pack is flagged stale by Dan's photo, then written to by his reaction.
  await feed(dan, pack.id, image, 'dan new');
  await expect(page.getByText('2/2 fed today').first()).toBeVisible({ timeout: 15_000 });
  const { data: posted } = await admin.from('feeds').select('id').eq('pack_id', pack.id).eq('user_id', dan.id).single();
  const reactionsFetched = page.waitForResponse('**/rest/v1/rpc/feed_reactions', { timeout: 15_000 });
  await dan.client.rpc('react', { target_feed: posted!.id, emoji: 'fire' });
  await reactionsFetched;

  await page.getByText('Reacted').first().click();
  await expect(page.getByText('dan new')).toBeVisible();
});
