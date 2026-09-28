import { expect, test } from '@playwright/test';

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
