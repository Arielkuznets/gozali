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

type CameraPage = { cameraAsked: number };

/** Stands in for the browser's own question: it stays up, or it is answered no at once. */
async function askCamera(page: Page, answer: 'stays up' | 'no') {
  await page.addInitScript((answer) => {
    const asked = window as unknown as CameraPage;
    asked.cameraAsked = 0;
    navigator.mediaDevices.getUserMedia = () => {
      asked.cameraAsked += 1;
      if (answer === 'no') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      return new Promise(() => undefined);
    };
  }, answer);
}

const cameraAsked = (page: Page) => page.evaluate(() => (window as unknown as CameraPage).cameraAsked);

test('feeding: camera, caption, send, and the photo shows in the pack', async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'mochi' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'kid', health: 64, xp: 9 }).eq('pack_id', pack.id);
  await feed(dan, pack.id, await photo(page, '📚'), 'Finished the problem set');

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('Finished the problem set')).toBeVisible();
  await page.getByRole('button', { name: 'Feed', exact: true }).click();

  // The camera says it's ready a moment before its first frame; wait for the picture itself.
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video !== null && video.readyState >= 2 && video.videoWidth > 0;
  });
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

test('a feed while the pet is away says it counts toward its return, with no pet eating it', async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'mochi' }, [dan]);
  await admin.from('critters').update({ status: 'ran_away', stage: 'kid', health: 0, xp: 9 }).eq('pack_id', pack.id);

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByText('"Gone to find food"')).toBeVisible();
  await page.getByRole('button', { name: 'Feed', exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video !== null && video.readyState >= 2 && video.videoWidth > 0;
  });
  await page.getByRole('button', { name: 'Take photo' }).click();
  await page.getByRole('button', { name: 'Send' }).click();

  // The pack, with the same line about coming back, stays under the camera.
  const fed = page.getByText('Fed!', { exact: true });
  await expect(fed).toBeVisible();
  await expect(fed.locator('xpath=..')).toContainText('Three good days in a row bring Mochi back.');
  await expect(page.getByText('Mochi loved it!')).toBeHidden();
  await expect(page.getByLabel('Mochi eating')).toBeHidden();
});

test('a focus session left at the camera keeps its minutes for the photo', async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'mochi' });
  // A timer with no limit, 25 minutes in.
  await page.addInitScript(
    (session) => window.localStorage.setItem('gozali.focus', JSON.stringify(session)),
    { packId: pack.id, minutes: null, startedAt: Date.now() - 25 * 60_000, pausedAt: null, pausedMs: 0, notificationId: null },
  );
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  const focus = page.getByRole('button', { name: 'Focus', exact: true });
  const done = page.getByRole('button', { name: 'Done, take the photo' });

  await focus.click();
  await done.click();
  await expect(page.getByText('25 min')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await focus.click();
  await expect(page.getByText('Paused')).toBeVisible();
  await done.click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video !== null && video.readyState >= 2 && video.videoWidth > 0;
  });
  await page.getByRole('button', { name: 'Take photo' }).click();
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
  const { data: feeds } = await noa.client.from('feeds').select('focus_minutes').eq('user_id', noa.id);
  expect(feeds).toEqual([{ focus_minutes: 25 }]);

  await focus.click();
  await expect(page.getByRole('button', { name: 'No time limit' })).toBeVisible();
});

test('a member removed while the camera is open is told the pack is gone', async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'mochi' }, [dan]);
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.dismiss();
  });

  await signIn(page, dan);
  await page.goto(`/pack/${pack.id}/feed`);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video !== null && video.readyState >= 2 && video.videoWidth > 0;
  });
  await page.getByRole('button', { name: 'Take photo' }).click();
  const removed = await noa.client.rpc('remove_member', { target: pack.id, member: dan.id });
  expect(removed.error).toBeNull();
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText("This pack isn't here")).toBeVisible();
  expect(alerts).toEqual([]);
});

test('a photo past the five extras of the day says that was the last one', async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(noa, { name: 'Study buddies', habit: 'study', species: 'mochi' });
  const image = await photo(page, '📚');
  await feed(noa, pack.id, image, 'The counted one');
  for (let extra = 1; extra <= 5; extra++) await feed(noa, pack.id, image, `Extra ${extra}`, true);
  const alerts: string[] = [];
  page.on('dialog', (dialog) => {
    alerts.push(dialog.message());
    void dialog.dismiss();
  });

  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}`);
  await page.getByRole('button', { name: 'Post another photo' }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video !== null && video.readyState >= 2 && video.videoWidth > 0;
  });
  await page.getByRole('button', { name: 'Take photo' }).click();
  await page.getByRole('button', { name: 'Send' }).click();

  await expect.poll(() => alerts).toEqual(["That's all the photos for today. You can post up to 5 extras a day."]);
  const { data: feeds } = await noa.client.from('feeds').select('id').eq('pack_id', pack.id);
  expect(feeds).toHaveLength(6);
});

test("a camera link for a pack you're not in doesn't open the camera", async ({ context, page }) => {
  await context.grantPermissions(['camera']);
  const pack = await createPack(dan, { name: 'Night owls', habit: 'reading', species: 'mochi' });

  // For example a notification from before, or from an account that signed out on this phone.
  await signIn(page, noa);
  await page.goto(`/pack/${pack.id}/feed`);
  await expect(page.getByText("This pack isn't here")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take photo' })).toBeHidden();
  await page.getByRole('button', { name: 'Back to your packs' }).click();
  await expect(page.getByRole('button', { name: 'Join with a code' })).toBeVisible();
});

test.describe('the first tap on Feed, before the camera was ever allowed', () => {
  test('goes straight to the question, and yes opens the camera', async ({ page }) => {
    // This browser answers yes by itself, and only once it is asked.
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await page.getByRole('button', { name: 'Feed', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
  });

  test('puts nothing of ours before the question', async ({ page }) => {
    await askCamera(page, 'stays up');
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await page.getByRole('button', { name: 'Feed', exact: true }).click();

    await expect.poll(() => cameraAsked(page)).toBe(1);
    await expect(page.getByText('Camera needed')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Allow camera' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeHidden();
  });

  test('leaves Open settings and Close after a no', async ({ page }) => {
    await askCamera(page, 'no');
    const pack = await createPack(noa, { name: 'Gym squad', habit: 'gym', species: 'kit' });
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}`);
    await page.getByRole('button', { name: 'Feed', exact: true }).click();

    await expect(page.getByText('Camera needed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow camera' })).toBeHidden();
    expect(await cameraAsked(page)).toBe(1);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pack/${pack.id}$`));
  });

  test("doesn't ask for a pack you're not in", async ({ page }) => {
    await askCamera(page, 'stays up');
    const pack = await createPack(dan, { name: 'Night owls', habit: 'reading', species: 'mochi' });
    await signIn(page, noa);
    await page.goto(`/pack/${pack.id}/feed`);

    await expect(page.getByText("This pack isn't here")).toBeVisible();
    expect(await cameraAsked(page)).toBe(0);
  });
});
