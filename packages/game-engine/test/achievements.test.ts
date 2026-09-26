import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACHIEVEMENTS, canWear, newAchievements, wardrobe } from '../src/index.ts';
import type { AchievementKey, PackStats } from '../src/index.ts';

function stats(overrides: Partial<PackStats> = {}): PackStats {
  return {
    hatched: false,
    streak: 0,
    stage: 'egg',
    fullHouseDays: 0,
    earlyBirdDays: 0,
    nightOwlFeeds: 0,
    countedFeeds: 0,
    returns: 0,
    members: 2,
    ...overrides,
  };
}

const none: ReadonlySet<AchievementKey> = new Set();

describe('achievements', () => {
  it('gives every achievement its own wardrobe item', () => {
    const items = ACHIEVEMENTS.map((achievement) => achievement.item.key);
    assert.equal(new Set(items).size, items.length);
  });

  it('unlocks hatching and streak milestones', () => {
    assert.deepEqual(newAchievements(stats({ hatched: true, streak: 14, stage: 'kid' }), none), [
      'hatched',
      'streak_7',
      'streak_14',
    ]);
  });

  it('does not unlock an achievement twice', () => {
    const unlocked = new Set<AchievementKey>(['hatched', 'streak_7']);
    assert.deepEqual(newAchievements(stats({ hatched: true, streak: 7, stage: 'kid' }), unlocked), []);
  });

  it('counts day facts and pack totals', () => {
    const reached = newAchievements(
      stats({
        hatched: true,
        stage: 'baby',
        fullHouseDays: 1,
        earlyBirdDays: 5,
        nightOwlFeeds: 5,
        countedFeeds: 100,
        returns: 1,
        members: 8,
      }),
      new Set(['hatched']),
    );
    assert.deepEqual(reached, ['full_house', 'early_birds', 'night_owls', 'comeback', 'century', 'full_pack']);
    assert.deepEqual(newAchievements(stats({ earlyBirdDays: 4, nightOwlFeeds: 4, countedFeeds: 99 }), none), []);
  });

  it('unlocks grown up from adult on and legend only at legend', () => {
    assert.deepEqual(newAchievements(stats({ stage: 'adult' }), none), ['grown_up']);
    assert.deepEqual(newAchievements(stats({ stage: 'legend' }), none), ['grown_up', 'legend']);
  });
});

describe('wardrobe', () => {
  const unlocked = new Set<AchievementKey>(['hatched', 'streak_7', 'century']);

  it('lists the items of unlocked achievements', () => {
    assert.deepEqual(
      wardrobe(unlocked).map((item) => item.key),
      ['scarf', 'beanie', 'park'],
    );
  });

  it('accepts unlocked items in their own slots', () => {
    assert.equal(canWear({ head: 'beanie', neck: 'scarf', background: 'park' }, unlocked), true);
    assert.equal(canWear({}, unlocked), true);
  });

  it('rejects locked items and items in the wrong slot', () => {
    assert.equal(canWear({ head: 'halo' }, unlocked), false);
    assert.equal(canWear({ neck: 'beanie' }, unlocked), false);
  });
});
