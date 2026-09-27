import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowedMisses, memberOutcome, minutesIntoPackDay } from '../src/index.ts';
import { close, critter, fed, member, times } from './builders.ts';

describe('memberOutcome', () => {
  it('does not count members who left, have not started or are paused', () => {
    assert.equal(memberOutcome(member({ membership: 'left', fedToday: true }), 0), 'left');
    assert.equal(memberOutcome(member({ hasStarted: false }), 0), 'not_started');
    assert.equal(memberOutcome(member({ paused: true, fedToday: true }), 0), 'paused');
  });

  it('counts a feed from a sleeping member and ignores sleepers who did not feed', () => {
    assert.equal(memberOutcome(member({ membership: 'sleeping', fedToday: true }), 0), 'fed');
    assert.equal(memberOutcome(member({ membership: 'sleeping' }), 0), 'sleeping');
  });

  it('lets a feed win over a joker or a declared rest on the same day', () => {
    assert.equal(memberOutcome(member({ fedToday: true, jokerToday: true }), 0), 'fed');
    assert.equal(memberOutcome(member({ fedToday: true, restDeclaredToday: true }), 0), 'fed');
  });

  it('covers a member with a joker, a declared rest or an automatic rest day', () => {
    assert.equal(memberOutcome(member({ jokerToday: true }), 0), 'joker');
    assert.equal(memberOutcome(member({ restDeclaredToday: true }), 1), 'rest');
    assert.equal(memberOutcome(member({ restDaysUsedThisWeek: 2 }), 3), 'rest');
  });

  it('is a miss once the weekly rest days are used up', () => {
    assert.equal(memberOutcome(member({ restDaysUsedThisWeek: 3 }), 3), 'missed');
    assert.equal(memberOutcome(member(), 0), 'missed');
  });
});

describe('allowedMisses', () => {
  it('allows no miss for 2-4 counted members and one miss for 5-8', () => {
    assert.deepEqual([0, 2, 3, 4].map(allowedMisses), [0, 0, 0, 0]);
    assert.deepEqual([5, 6, 7, 8].map(allowedMisses), [1, 1, 1, 1]);
  });
});

describe('day types', () => {
  it('rewards a day where everyone fed', () => {
    const result = close(times(3, () => fed()));
    assert.equal(result.type, 'success');
    assert.equal(result.critter.health, 80);
    assert.equal(result.critter.xp, 11);
    assert.equal(result.critter.streak, 4);
  });

  it('fails a small pack on a single miss', () => {
    const result = close([...times(3, () => fed()), member()]);
    assert.equal(result.type, 'fail');
    assert.equal(result.critter.health, 62);
    assert.equal(result.critter.xp, 10);
    assert.equal(result.critter.streak, 0);
  });

  it('lets a pack of five or more absorb one miss, which still costs health', () => {
    const result = close([...times(5, () => fed()), member()]);
    assert.equal(result.type, 'success');
    assert.equal(result.allowedMisses, 1);
    assert.equal(result.critter.health, 72);
    assert.equal(result.critter.xp, 11);
    assert.equal(result.critter.streak, 4);
  });

  it('fails a pack of five on two misses', () => {
    const result = close([...times(3, () => fed()), member(), member()]);
    assert.equal(result.type, 'fail');
    assert.equal(result.critter.health, 54);
  });

  it('keeps a day without feeds neutral', () => {
    const result = close(times(3, () => member({ restDeclaredToday: true })), {}, 1);
    assert.equal(result.type, 'neutral');
    assert.deepEqual(result.critter, critter());
  });

  it('still charges an allowed miss on a neutral day', () => {
    const result = close([...times(4, () => member({ jokerToday: true })), member()]);
    assert.equal(result.type, 'neutral');
    assert.equal(result.critter.health, 62);
    assert.equal(result.critter.streak, 3);
    assert.equal(result.critter.xp, 10);
  });

  it('treats a day where nobody counts as neutral', () => {
    const result = close(times(3, () => member({ paused: true })));
    assert.equal(result.type, 'neutral');
    assert.equal(result.counted, 0);
  });

  it('ignores members who never fed', () => {
    const result = close([fed(), fed(), ...times(3, () => member({ hasStarted: false }))]);
    assert.equal(result.counted, 2);
    assert.equal(result.type, 'success');
  });

  it('sums bonus and penalty before clamping to the health limits', () => {
    const result = close([...times(4, () => fed()), member()], { health: 100 });
    assert.equal(result.critter.health, 100);
  });
});

describe('egg', () => {
  it('changes nothing until two members feed on a successful day', () => {
    const egg = { status: 'egg' as const, health: 70, xp: 0, stage: 'egg' as const, streak: 0 };
    const result = close([fed(), member({ hasStarted: false })], egg);
    assert.equal(result.applied, false);
    assert.equal(result.critter.status, 'egg');
    assert.equal(result.critter.xp, 0);
    assert.deepEqual(result.facts, { fullHouse: false, earlyBird: false, nightOwlFeeds: 0 });
  });

  it('hatches into a baby on the first successful day with two feeders', () => {
    const egg = { status: 'egg' as const, health: 70, xp: 0, stage: 'egg' as const, streak: 0 };
    const result = close([fed(), fed()], egg);
    assert.equal(result.applied, true);
    assert.equal(result.critter.status, 'active');
    assert.equal(result.critter.stage, 'baby');
    assert.equal(result.critter.xp, 1);
    assert.equal(result.critter.health, 80);
    assert.equal(result.critter.streak, 1);
    assert.deepEqual(result.events, [{ type: 'hatched' }]);
  });

  it('ignores failed days while still an egg', () => {
    const egg = { status: 'egg' as const, health: 70, xp: 0, stage: 'egg' as const, streak: 0 };
    const result = close([fed(), member()], egg);
    assert.equal(result.type, 'fail');
    assert.equal(result.applied, false);
    assert.equal(result.critter.health, 70);
  });
});

describe('running away and coming back', () => {
  it('runs away when health reaches zero and resets the streak', () => {
    const result = close([fed(), member()], { health: 8, streak: 0 });
    assert.equal(result.critter.status, 'ran_away');
    assert.equal(result.critter.health, 0);
    assert.ok(result.events.some((event) => event.type === 'ran_away'));
  });

  it('resets the streak when it runs away on a neutral day', () => {
    const result = close([...times(4, () => member({ jokerToday: true })), member()], { health: 8, streak: 10 });
    assert.equal(result.type, 'neutral');
    assert.equal(result.critter.status, 'ran_away');
    assert.equal(result.critter.streak, 0);
  });

  it('earns no health or XP while away', () => {
    const away = { status: 'ran_away' as const, health: 0, streak: 0 };
    const result = close([fed(), fed()], away);
    assert.equal(result.critter.status, 'ran_away');
    assert.equal(result.critter.health, 0);
    assert.equal(result.critter.xp, 10);
    assert.equal(result.critter.streak, 1);
  });

  it('comes back with 40 health and a bandage after three successful days in a row', () => {
    const away = { status: 'ran_away' as const, health: 0, streak: 2 };
    const result = close([fed(), fed()], away);
    assert.equal(result.critter.status, 'active');
    assert.equal(result.critter.health, 40);
    assert.deepEqual(result.critter.marks, ['bandage']);
    assert.ok(result.events.some((event) => event.type === 'returned'));
  });

  it('starts the count over after a failed day while away', () => {
    const result = close([fed(), member()], { status: 'ran_away', health: 0, streak: 2 });
    assert.equal(result.critter.status, 'ran_away');
    assert.equal(result.critter.streak, 0);
  });
});

describe('stages and marks', () => {
  it('evolves when XP crosses a threshold', () => {
    const result = close([fed(), fed()], { xp: 6, stage: 'baby' });
    assert.equal(result.critter.stage, 'kid');
    assert.ok(result.events.some((event) => event.type === 'evolved' && event.from === 'baby' && event.to === 'kid'));
  });

  it('never moves a critter down a stage', () => {
    const result = close([fed(), fed()], { xp: 10, stage: 'teen' });
    assert.equal(result.critter.stage, 'teen');
    assert.ok(!result.events.some((event) => event.type === 'evolved'));
  });

  it('awards the medal once at a 30 day streak', () => {
    const first = close([fed(), fed()], { streak: 29 });
    assert.deepEqual(first.critter.marks, ['medal']);
    const again = close([fed(), fed()], { streak: 40, marks: ['medal'] });
    assert.deepEqual(again.critter.marks, ['medal']);
    assert.ok(!again.events.some((event) => event.type === 'mark_added'));
  });

  it('reports when the health state changes', () => {
    const result = close([fed(), member()], { health: 45 });
    assert.ok(
      result.events.some(
        (event) => event.type === 'health_state_changed' && event.from === 'hungry' && event.to === 'weak',
      ),
    );
  });
});

describe('sleep', () => {
  it('puts a member to sleep on the third miss in the window', () => {
    const tired = member({ recentMisses: 2 });
    const result = close([fed(), fed(), tired]);
    assert.deepEqual(result.newlySleeping, [tired.userId]);
    assert.ok(result.events.some((event) => event.type === 'member_slept' && event.userId === tired.userId));
  });

  it('does not count rest days as misses', () => {
    const resting = member({ recentMisses: 2 });
    const result = close([fed(), fed(), resting], {}, 3);
    assert.deepEqual(result.newlySleeping, []);
  });
});

describe('facts', () => {
  it('finds a full house when every counted member of four or more fed', () => {
    assert.equal(close(times(4, () => fed())).facts.fullHouse, true);
    assert.equal(close(times(3, () => fed())).facts.fullHouse, false);
    assert.equal(close([...times(3, () => fed()), member({ jokerToday: true })]).facts.fullHouse, false);
  });

  it('marks early birds when every feeder fed before noon', () => {
    const early = minutesIntoPackDay(11, 59);
    const late = minutesIntoPackDay(12);
    assert.equal(close([fed({ fedAtMinute: 60 }), fed({ fedAtMinute: early })]).facts.earlyBird, true);
    assert.equal(close([fed({ fedAtMinute: 60 }), fed({ fedAtMinute: late })]).facts.earlyBird, false);
    assert.equal(close([fed({ fedAtMinute: 60 }), member({ jokerToday: true })]).facts.earlyBird, false);
  });

  it('counts feeds from 23:00 until the day ends as night owl feeds', () => {
    const facts = close([
      fed({ fedAtMinute: minutesIntoPackDay(23, 30) }),
      fed({ fedAtMinute: minutesIntoPackDay(1, 15) }),
      fed({ fedAtMinute: minutesIntoPackDay(22, 59) }),
    ]).facts;
    assert.equal(facts.nightOwlFeeds, 2);
  });
});

describe('coins', () => {
  it('a successful day earns one coin, more as the streak grows', () => {
    assert.equal(close([fed(), fed()], { streak: 0 }).coins, 1);
    assert.equal(close([fed(), fed()], { streak: 6 }).coins, 2, 'the 7th day in a row');
    assert.equal(close([fed(), fed()], { streak: 13 }).coins, 3);
    assert.equal(close([fed(), fed()], { streak: 29 }).coins, 5);
    assert.equal(close([fed(), fed()], { streak: 80 }).coins, 5);
  });

  it('neutral and failed days earn nothing', () => {
    assert.equal(close([member({ restDaysUsedThisWeek: 0 })], { streak: 10 }, 1).coins, 0, 'neutral');
    assert.equal(close([fed(), member()], { streak: 10 }).coins, 0, 'failed');
  });

  it('the hatching day earns its coin, egg and away days earn nothing', () => {
    assert.equal(close([fed(), fed()], { status: 'egg', stage: 'egg', xp: 0, streak: 0 }).coins, 1);
    assert.equal(close([fed()], { status: 'egg', stage: 'egg', xp: 0, streak: 0 }).coins, 0);
    assert.equal(close([fed(), fed()], { status: 'ran_away', health: 0, streak: 0 }).coins, 0);
    assert.equal(close([fed(), fed()], { status: 'ran_away', health: 0, streak: 2 }).coins, 0, 'not even the day it returns');
  });
});
