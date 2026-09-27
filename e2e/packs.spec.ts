import { expect, test } from '@playwright/test';

import { createPack, createUser, removeUsers, signIn, type TestUser } from './support';

let noa: TestUser;
let dan: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
});

test.afterEach(async () => {
  await removeUsers(noa, dan);
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

  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(new RegExp(`/pack/${created.id}$`));
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
