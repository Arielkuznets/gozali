import { addDays, packDayOf } from '@gozali/game-engine';
import { expect, test } from '@playwright/test';

import { admin, createPack, createUser, removeUsers, signIn, type TestUser } from './support';

const ZONE = 'Asia/Jerusalem';
test.use({ timezoneId: ZONE });

let noa: TestUser;
let dan: TestUser;

test.beforeEach(async () => {
  noa = await createUser('Noa');
  dan = await createUser('Dan');
});

test.afterEach(async () => {
  await removeUsers(noa, dan);
});

const formatDay = (day: string) =>
  new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`));

test('both boards say in words who fed, rested and missed', async ({ page }) => {
  const pack = await createPack(noa, { name: 'Readers', habit: 'reading', species: 'hoot' }, [dan]);
  await admin.from('critters').update({ status: 'active', stage: 'baby', xp: 3, health: 70 }).eq('pack_id', pack.id);
  const today = packDayOf(new Date(), ZONE);
  const [fed, missed, rested] = [1, 2, 3].map((back) => addDays(today, -back));
  const day = (date: string, ids: Partial<Record<'fed_ids' | 'missed_ids' | 'rested_ids', string[]>>) => ({
    pack_id: pack.id,
    day: date,
    result: 'success',
    applied: true,
    health_before: 70,
    health_after: 70,
    fed_ids: [],
    missed_ids: [],
    rested_ids: [],
    ...ids,
  });
  const inserted = await admin.from('day_results').insert([
    day(fed!, { fed_ids: [noa.id, dan.id] }),
    day(missed!, { fed_ids: [dan.id], missed_ids: [noa.id] }),
    day(rested!, { fed_ids: [dan.id], rested_ids: [noa.id] }),
  ]);
  if (inserted.error) throw inserted.error;

  await signIn(page, noa);
  await page.goto('/me');
  await expect(page.getByLabel(`${formatDay(fed!)}, fed`)).toBeVisible();
  await expect(page.getByLabel(`${formatDay(missed!)}, missed`)).toBeVisible();
  await expect(page.getByLabel(`${formatDay(rested!)}, rest or joker`)).toBeVisible();
  // Today is the board's last square and isn't closed yet.
  await expect(page.getByLabel(formatDay(today), { exact: true })).toBeVisible();

  // The pack's board shows this month only.
  const month = (dates: string[]) => dates.filter((date) => date.startsWith(today.slice(0, 7))).length;
  await page.goto(`/pack/${pack.id}/critter`);
  await expect(
    page.getByLabel(`Noa: ${month([fed!])} fed, ${month([rested!])} rest or joker, 0 paused or asleep, ${month([missed!])} missed`),
  ).toBeVisible();
  await expect(page.getByLabel(`Dan: ${month([fed!, missed!, rested!])} fed, 0 rest or joker, 0 paused or asleep, 0 missed`)).toBeVisible();
});
