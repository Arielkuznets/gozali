import { stageRank } from './stages.ts';
import type { Stage } from './types.ts';

export type WardrobeSlot = 'head' | 'neck' | 'background';

export type AchievementKey =
  | 'hatched'
  | 'streak_7'
  | 'streak_14'
  | 'streak_30'
  | 'full_house'
  | 'early_birds'
  | 'night_owls'
  | 'comeback'
  | 'century'
  | 'full_pack'
  | 'grown_up'
  | 'legend';

export interface WardrobeItem {
  key: string;
  slot: WardrobeSlot;
}

/** Pack-wide totals the achievements are checked against, including the day just closed. */
export interface PackStats {
  hatched: boolean;
  streak: number;
  stage: Stage;
  fullHouseDays: number;
  earlyBirdDays: number;
  nightOwlFeeds: number;
  countedFeeds: number;
  returns: number;
  members: number;
}

interface Achievement {
  key: AchievementKey;
  item: WardrobeItem;
  reached: (stats: PackStats) => boolean;
}

/** Each achievement unlocks exactly one wardrobe item (spec section 4). */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { key: 'hatched', item: { key: 'scarf', slot: 'neck' }, reached: (s) => s.hatched },
  { key: 'streak_7', item: { key: 'beanie', slot: 'head' }, reached: (s) => s.streak >= 7 },
  { key: 'streak_14', item: { key: 'flower_crown', slot: 'head' }, reached: (s) => s.streak >= 14 },
  { key: 'streak_30', item: { key: 'cape', slot: 'neck' }, reached: (s) => s.streak >= 30 },
  { key: 'full_house', item: { key: 'bow_tie', slot: 'neck' }, reached: (s) => s.fullHouseDays >= 1 },
  { key: 'early_birds', item: { key: 'sun_hat', slot: 'head' }, reached: (s) => s.earlyBirdDays >= 5 },
  { key: 'night_owls', item: { key: 'headlamp', slot: 'head' }, reached: (s) => s.nightOwlFeeds >= 5 },
  { key: 'comeback', item: { key: 'sunrise', slot: 'background' }, reached: (s) => s.returns >= 1 },
  { key: 'century', item: { key: 'park', slot: 'background' }, reached: (s) => s.countedFeeds >= 100 },
  { key: 'full_pack', item: { key: 'party', slot: 'background' }, reached: (s) => s.members >= 8 },
  {
    key: 'grown_up',
    item: { key: 'space', slot: 'background' },
    reached: (s) => stageRank(s.stage) >= stageRank('adult'),
  },
  { key: 'legend', item: { key: 'halo', slot: 'head' }, reached: (s) => s.stage === 'legend' },
];

/** Achievements reached now that were not unlocked before, in table order. */
export function newAchievements(stats: PackStats, unlocked: ReadonlySet<AchievementKey>): AchievementKey[] {
  return ACHIEVEMENTS.filter((achievement) => !unlocked.has(achievement.key) && achievement.reached(stats)).map(
    (achievement) => achievement.key,
  );
}

export function wardrobe(unlocked: ReadonlySet<AchievementKey>): WardrobeItem[] {
  return ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.key)).map((achievement) => achievement.item);
}

/** What the critter wears: at most one item per slot. */
export type Outfit = Partial<Record<WardrobeSlot, string>>;

/** An outfit is valid when every item is unlocked and sits in its own slot. */
export function canWear(outfit: Outfit, unlocked: ReadonlySet<AchievementKey>): boolean {
  const owned = wardrobe(unlocked);
  return Object.entries(outfit).every(
    ([slot, itemKey]) =>
      itemKey === undefined || owned.some((item) => item.key === itemKey && item.slot === slot),
  );
}
