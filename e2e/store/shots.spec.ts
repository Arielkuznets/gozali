// Store screenshots (docs/store-listing.md): real app screens with sample data, each framed under
// a caption, in the App Store sizes (1320 × 2868 and 1284 × 2778) and a Google Play size (1080 × 2160, since Play
// allows at most 2:1).
import { addDays, packDayOf } from '@gozali/game-engine';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { admin, createPack, createUser, removeUsers, signIn, type TestUser } from '../support';

const ZONE = 'Asia/Jerusalem';
const OUTPUT = fileURLToPath(new URL('./output/', import.meta.url));
const FONT = readFileSync(
  fileURLToPath(new URL('../../node_modules/@expo-google-fonts/varela-round/400Regular/VarelaRound_400Regular.ttf', import.meta.url)),
).toString('base64');

type Canvas = { name: string; width: number; height: number; scale: number; phoneWidth: number; phoneTop: number; fontSize: number };
const CANVASES: Canvas[] = [
  { name: 'app-store', width: 440, height: 956, scale: 3, phoneWidth: 372, phoneTop: 196, fontSize: 36 },
  // App Store Connect may ask for the 6.5" size (1284 × 2778) instead of 6.9".
  { name: 'app-store-6.5', width: 428, height: 926, scale: 3, phoneWidth: 362, phoneTop: 190, fontSize: 35 },
  { name: 'google-play', width: 432, height: 864, scale: 2.5, phoneWidth: 330, phoneTop: 172, fontSize: 32 },
];

let users: TestUser[] = [];

test.afterAll(async () => {
  await removeUsers(...users);
});

/** A stand-in photo: an emoji on a soft gradient, like a snapshot of the habit. */
async function picture(page: Page, emoji: string, from: string, to: string): Promise<Buffer> {
  await page.setContent(
    `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;` +
      `background:linear-gradient(160deg,${from},${to});font:150px system-ui">${emoji}</body>`,
  );
  return await page.screenshot({ type: 'jpeg', quality: 85 });
}

/** Puts an app screen under its caption, in each store's size. */
async function frame(browser: Browser, screen: Buffer, caption: string, file: string) {
  for (const canvas of CANVASES) {
    const context = await browser.newContext({ viewport: { width: canvas.width, height: canvas.height }, deviceScaleFactor: canvas.scale });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><head><style>
      @font-face { font-family: Heading; src: url(data:font/ttf;base64,${FONT}); }
      body { margin: 0; width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden;
        background: radial-gradient(circle at 20% 0%, #FFE9D6 0%, #FBF6EE 55%); color: #3B2F2A; font-family: Heading; }
      h1 { margin: 0; padding: ${Math.round(canvas.phoneTop * 0.3)}px 28px 0; font-weight: 400; text-align: center;
        font-size: ${canvas.fontSize}px; line-height: 1.18; }
      h1 em { font-style: normal; color: #E8795A; }
      .phone { position: absolute; top: ${canvas.phoneTop}px; left: 50%; transform: translateX(-50%); width: ${canvas.phoneWidth}px;
        border-radius: 46px; overflow: hidden; background: #FBF6EE;
        box-shadow: 0 0 0 9px #3B2F2A, 0 24px 60px rgba(59, 47, 42, 0.25); }
      .phone img { display: block; width: 100%; }
    </style></head><body>
      <h1>${caption}</h1>
      <div class="phone"><img src="data:image/png;base64,${screen.toString('base64')}"></div>
    </body></html>`);
    await page.evaluate(() => document.fonts.ready);
    mkdirSync(`${OUTPUT}${canvas.name}`, { recursive: true });
    writeFileSync(`${OUTPUT}${canvas.name}/${file}`, await page.screenshot({ type: 'png' }));
    await context.close();
  }
}

/** The app screen as it is now, once its photos have loaded. */
async function shoot(page: Page): Promise<Buffer> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  return await page.screenshot({ type: 'png' });
}

async function scrollTo(page: Page, text: string) {
  await page.getByText(text, { exact: true }).first().evaluate((element) => element.scrollIntoView({ block: 'start' }));
}

test('store screenshots', async ({ page, browser }) => {
  const [noa, dan, maya, ben] = (users = await Promise.all(['Noa', 'Dan', 'Maya', 'Ben'].map(createUser))) as [
    TestUser,
    TestUser,
    TestUser,
    TestUser,
  ];
  const pack = await createPack(noa, { name: 'Morning runs', habit: 'running', species: 'axo' }, [dan, maya, ben]);
  const today = packDayOf(new Date(), ZONE);

  // Splash, a teen axolotl twelve days into a streak, in a cap the pack bought and the scarf it earned.
  await admin
    .from('critters')
    .update({ status: 'active', stage: 'teen', xp: 26, health: 91, streak: 12, name: 'Splash', coins: 34, outfit: { head: 'cap', neck: 'scarf' } })
    .eq('pack_id', pack.id);
  await admin.from('achievements').insert([
    { pack_id: pack.id, key: 'hatched', unlocked_at: new Date(Date.now() - 20 * 86_400_000).toISOString() },
    { pack_id: pack.id, key: 'streak_7', unlocked_at: new Date(Date.now() - 5 * 86_400_000).toISOString() },
  ]);
  await admin.from('pack_items').insert({ pack_id: pack.id, item: 'cap', bought_by: dan.id });

  // Photos: last week's for the recap, and today's from everyone but Noa, who is about to feed.
  const looks: [string, string, string][] = [
    ['🏃', '#FBD3B0', '#E8795A'],
    ['🌅', '#FFE3A3', '#F29E6D'],
    ['👟', '#BFE0D0', '#5FA88A'],
    ['🏞️', '#CFE6F5', '#6BAAD8'],
    ['⏱️', '#E9DDF5', '#A58BC9'],
    ['🥤', '#FDE7C4', '#E2B437'],
  ];
  const photos: Buffer[] = [];
  for (const [emoji, from, to] of looks) photos.push(await picture(page, emoji, from, to));

  const post = async (member: TestUser, day: string, hour: number, index: number, caption: string | null) => {
    const path = `${pack.id}/${member.id}/${day}-${index}.jpg`;
    const upload = await admin.storage.from('feed-photos').upload(path, photos[index % photos.length]!, { contentType: 'image/jpeg' });
    if (upload.error) throw upload.error;
    const at = new Date(`${day}T${String(hour).padStart(2, '0')}:${String((10 + index * 7) % 60).padStart(2, '0')}:00+03:00`).toISOString();
    const { data, error } = await admin
      .from('feeds')
      .insert({ pack_id: pack.id, user_id: member.id, day, photo_path: path, caption, created_at: at, captured_at: at })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  };

  const lastWeek: string[] = [];
  for (let back = 8; back >= 2; back--) {
    const day = addDays(today, -back);
    for (const [index, member] of [dan, maya, ben, noa].entries()) {
      if ((back + index) % 4 === 0) continue;
      lastWeek.push(await post(member, day, 7, index + back, null));
    }
  }
  const run = await post(dan, today, 6, 0, '5k before work ☀️');
  const sunrise = await post(maya, today, 7, 1, 'That sunrise though');
  const shoes = await post(ben, today, 8, 2, 'New shoes day 👟');
  const reactions = [
    { feed_id: run, user_id: maya.id, emoji: 'fire' },
    { feed_id: run, user_id: ben.id, emoji: 'muscle' },
    { feed_id: run, user_id: noa.id, emoji: 'fire' },
    { feed_id: sunrise, user_id: dan.id, emoji: 'clap' },
    { feed_id: sunrise, user_id: noa.id, emoji: 'clap' },
    { feed_id: shoes, user_id: dan.id, emoji: 'fire' },
    { feed_id: shoes, user_id: maya.id, emoji: 'laugh' },
    { feed_id: shoes, user_id: noa.id, emoji: 'clap' },
  ];
  const reacted = await admin.from('reactions').insert(reactions);
  if (reacted.error) throw reacted.error;
  // The sample data made its own feed events (joins, hatching, naming...); keep one purchase.
  await admin.from('pack_events').delete().eq('pack_id', pack.id);
  await admin.from('pack_events').insert({
    pack_id: pack.id,
    kind: 'bought',
    actor_id: dan.id,
    payload: { item: 'cap', slot: 'head', price: 12 },
    created_at: new Date(`${addDays(today, -1)}T19:30:00+03:00`).toISOString(),
  });

  // Last week's recap.
  const { data: rules } = await admin.from('packs').select('week_start').eq('id', pack.id).single();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday - (rules?.week_start === 'monday' ? 1 : 0) + 7) % 7) - 7);
  const recap = await admin.from('weekly_recaps').insert({
    pack_id: pack.id,
    week_start: weekStart,
    feed_ids: lastWeek.slice(-9),
    stats: {
      weekStart,
      weekEnd: addDays(weekStart, 6),
      days: 7,
      successDays: 6,
      healthStart: 76,
      healthEnd: 91,
      coins: 13,
      topMembers: [dan.id, maya.id],
      topFeeds: 7,
      achievements: ['streak_7'],
      critter: { name: 'Splash', species: 'axo', stage: 'teen', status: 'active', health: 91, streak: 12, marks: [], outfit: { head: 'cap', neck: 'scarf' } },
    },
  });
  if (recap.error) throw recap.error;

  // Midday on the pack day, whatever the time now: at night the critter would be asleep.
  await page.clock.setFixedTime(new Date(today + 'T09:00:00Z'));
  await signIn(page, noa);

  // 1. The pack screen.
  await page.goto(`/pack/${pack.id}`);
  await expect(page.getByRole('button', { name: 'Feed', exact: true })).toBeVisible();
  await frame(browser, await shoot(page), 'Raise a pet<br><em>with your friends</em>', '1-pack.png');

  // 2. The feed with reactions.
  await scrollTo(page, 'Pack feed');
  await frame(browser, await shoot(page), 'Feed it a photo,<br><em>cheer each other on</em>', '2-feed.png');

  // 3. Picking a critter for a new pack.
  await page.goto('/create-pack');
  await page.getByLabel('Pack name').fill('Book club');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: 'Reading' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /^Hoot/ }).click();
  await frame(browser, await shoot(page), 'Six critters,<br><em>six personalities</em>', '3-critters.png');

  // 4. The wardrobe and the shop.
  await page.goto(`/pack/${pack.id}/critter`);
  await expect(page.getByText('Wardrobe', { exact: true })).toBeVisible();
  await scrollTo(page, 'Wardrobe');
  await frame(browser, await shoot(page), 'Keep the streak,<br><em>dress it up</em>', '4-shop.png');

  // 5. The weekly recap.
  await page.goto(`/pack/${pack.id}/recap`);
  await frame(browser, await shoot(page), 'Look back on<br><em>your week together</em>', '5-recap.png');
});
