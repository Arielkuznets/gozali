// Every screen of the app with sample data, for looking over the UI: `npm run ui:gallery` after
// `npm run e2e:build`, with the local Supabase stack running. The images land in
// e2e/store/output/gallery (a regular phone) and gallery-small (a small one).
import { addDays, packDayOf } from '@gozali/game-engine';
import { createClient } from '@supabase/supabase-js';
import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { admin, createPack, createUser, feed, photo, removeUsers, signIn, type TestUser } from '../support';

const ZONE = 'Asia/Jerusalem';
const OUTPUT = fileURLToPath(new URL('./output/', import.meta.url));

const SIZES = [
  { name: 'gallery', width: 390, height: 844 },
  { name: 'gallery-small', width: 360, height: 640 },
] as const;

const users: TestUser[] = [];
test.afterAll(async () => {
  await removeUsers(...users);
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });

    test(`every screen (${size.name})`, async ({ page, browser }) => {
      const folder = `${OUTPUT}${size.name}`;
      mkdirSync(folder, { recursive: true });
      let count = 0;
      const shot = async (target: Page, name: string) => {
        await target.waitForLoadState('networkidle').catch(() => undefined);
        await target.waitForTimeout(700);
        count++;
        await target.screenshot({ path: `${folder}/${String(count).padStart(2, '0')}-${name}.png` });
      };
      const scrollTo = async (target: Page, text: string) => {
        await target.getByText(text, { exact: true }).first().evaluate((element) => element.scrollIntoView({ block: 'start' }));
      };

      // Signed out.
      const outside = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      // A first launch shows the rules, then the sign-in screen.
      await outside.goto('/welcome');
      for (let card = 1; card <= 4; card++) {
        await shot(outside, `onboarding-${card}`);
        await outside.getByRole('button', { name: card < 4 ? 'Next' : "Let's go" }).click();
      }
      await shot(outside, 'welcome');
      await outside.close();

      // Someone who signed in but hasn't set up a profile.
      const email = `setup-${Date.now()}@gozali.test`;
      const created = await admin.auth.admin.createUser({ email, password: 'setup-pass-1', email_confirm: true });
      const fresh = createClient('http://127.0.0.1:54321', process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
      const signedIn = await fresh.auth.signInWithPassword({ email, password: 'setup-pass-1' });
      const setupPage = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      await signIn(setupPage, { id: created.data.user!.id, name: '', client: fresh, session: signedIn.data.session! });
      await setupPage.goto('/');
      await shot(setupPage, 'profile-setup');
      await setupPage.close();
      await admin.auth.admin.deleteUser(created.data.user!.id);

      const people = await Promise.all(['Noa', 'Dan', 'Maya', 'Ben', 'Eli'].map(createUser));
      users.push(...people);
      const [noa, dan, maya, ben, eli] = people as [TestUser, TestUser, TestUser, TestUser, TestUser];
      const today = packDayOf(new Date(), ZONE);

      // An active pack, an egg Noa is alone with, and a study pack.
      const runs = await createPack(noa, { name: 'Morning runs', habit: 'running', species: 'axo' }, [dan, maya, ben]);
      await admin
        .from('critters')
        .update({ status: 'active', stage: 'teen', xp: 26, health: 64, streak: 12, name: 'Splash', coins: 34, outfit: { head: 'cap' } })
        .eq('pack_id', runs.id);
      await admin.from('pack_items').insert({ pack_id: runs.id, item: 'cap', bought_by: dan.id });
      await admin.from('achievements').insert({ pack_id: runs.id, key: 'hatched' });
      const picture = await photo(page, '🏃');
      await feed(dan, runs.id, picture, 'Hill repeats, done');
      await feed(maya, runs.id, picture, 'A slow 5k but it counts');
      await admin.from('day_results').insert(
        [1, 2, 3, 4, 5].map((back) => ({
          pack_id: runs.id,
          day: addDays(today, -back),
          result: back === 3 ? 'fail' : 'success',
          applied: true,
          health_before: 60,
          health_after: 64,
          fed_ids: back === 3 ? [dan.id] : [noa.id, dan.id, maya.id],
          missed_ids: back === 3 ? [noa.id, maya.id, ben.id] : [],
          rested_ids: back === 3 ? [] : [ben.id],
          joker_ids: [],
          paused_ids: [],
          sleeping_ids: [],
        })),
      );
      const egg = await createPack(noa, { name: 'Book club', habit: 'reading', species: 'hoot' });
      const study = await createPack(noa, { name: 'Exam prep', habit: 'study', species: 'bun' }, [eli]);
      await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 2, health: 88, streak: 2 }).eq('pack_id', study.id);
      await admin.from('weekly_recaps').insert({
        pack_id: runs.id,
        week_start: addDays(today, -8),
        feed_ids: [],
        stats: {
          weekStart: addDays(today, -8),
          weekEnd: addDays(today, -2),
          days: 7,
          successDays: 5,
          healthStart: 58,
          healthEnd: 64,
          coins: 9,
          topMembers: [dan.id],
          topFeeds: 7,
          achievements: [],
          critter: { name: 'Splash', species: 'axo', stage: 'teen', status: 'active', health: 64, streak: 12, marks: [], outfit: { head: 'cap' } },
        },
      });

      page.on('dialog', (dialog) => void dialog.dismiss());
      await signIn(page, noa);
      await page.goto('/');
      await shot(page, 'home');
      await page.goto(`/pack/${runs.id}`);
      await shot(page, 'pack');
      await scrollTo(page, 'Pack feed');
      await shot(page, 'pack-feed');
      await page.getByRole('button', { name: 'Ben, not yet today' }).click({ delay: 900 }).catch(() => undefined);
      await shot(page, 'member-menu');
      await page.goto(`/pack/${egg.id}`);
      await shot(page, 'pack-egg');
      await page.goto(`/pack/${study.id}`);
      await shot(page, 'pack-study');
      await page.goto(`/pack/${study.id}/focus`);
      await shot(page, 'focus');
      await page.goto(`/pack/${runs.id}/not-today`);
      await shot(page, 'not-today');
      await page.goto(`/pack/${runs.id}/settings`);
      await shot(page, 'pack-settings');
      await scrollTo(page, 'Members');
      await shot(page, 'pack-settings-2');
      await page.goto(`/pack/${runs.id}/critter`);
      await shot(page, 'critter');
      await scrollTo(page, 'Wardrobe');
      await shot(page, 'critter-wardrobe');
      await scrollTo(page, 'Achievements');
      await shot(page, 'critter-achievements');
      await page.goto(`/pack/${runs.id}/recap`);
      await shot(page, 'recap');
      await page.goto(`/pack/${egg.id}/invite`);
      await shot(page, 'invite');
      await page.goto('/me');
      await shot(page, 'me');
      await page.goto('/settings');
      await shot(page, 'settings');
      await scrollTo(page, 'Blocked people');
      await shot(page, 'settings-2');
      await page.goto('/how-it-works');
      await shot(page, 'how-it-works');
      await page.goto('/create-pack');
      await shot(page, 'create-1');
      await page.getByLabel('Pack name').fill('Water squad');
      await page.getByRole('button', { name: 'Next' }).click();
      await shot(page, 'create-2');
      await page.getByRole('radio', { name: 'Water' }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      await shot(page, 'create-3');
      await page.getByRole('button', { name: 'Next' }).click();
      await shot(page, 'create-4');

      // Someone new: an empty home and joining with a code.
      const newcomer = await browser.newPage({ viewport: { width: size.width, height: size.height } });
      await signIn(newcomer, ben);
      await admin.from('pack_members').delete().eq('user_id', ben.id);
      await newcomer.goto('/');
      await shot(newcomer, 'home-empty');
      await newcomer.goto(`/join?code=${egg.inviteCode}`);
      await shot(newcomer, 'join');
      await newcomer.close();
    });
  });
}
