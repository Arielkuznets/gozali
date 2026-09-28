import { critterArt, isNight, localDay, parseOutfit, stageProgress } from '@/features/critter/art';
import type { PackCritter } from '@/features/packs/api';

const critter: PackCritter = {
  species: 'kit',
  name: 'Pixel',
  health: 50,
  xp: 10,
  stage: 'kid',
  status: 'active',
  streak: 2,
  coins: 0,
  marks: ['bandage', 'glitter'],
  outfit: { head: 'beanie', neck: 'boa' },
};

describe('stage progress', () => {
  it('runs from the current stage to the next', () => {
    expect(stageProgress('kid')).toEqual({ next: 'teen', from: 7, to: 21 });
  });

  it('ends at Legend', () => {
    expect(stageProgress('legend')).toBeNull();
    expect(stageProgress('egg')).toBeNull();
  });
});

describe('critter art', () => {
  it('keeps only known outfit items and marks', () => {
    expect(parseOutfit(critter.outfit)).toEqual({ head: 'beanie', neck: undefined, background: undefined });
    const art = critterArt(critter, { category: 'gym', now: new Date(2026, 8, 27, 12) });
    expect(art.marks).toEqual(['bandage']);
    expect(art.look).toBe('hungry');
    expect(art.categoryItem).toBe('dumbbell');
  });

  it('sleeps from 22:00 to 07:00 on the device clock', () => {
    expect(isNight(new Date(2026, 8, 27, 22, 30))).toBe(true);
    expect(isNight(new Date(2026, 8, 27, 6, 59))).toBe(true);
    expect(isNight(new Date(2026, 8, 27, 7, 0))).toBe(false);
  });

  it('wears the holiday hat on a holiday of the device calendar', () => {
    const hanukkah = new Date(2026, 11, 6, 12);
    expect(localDay(hanukkah)).toBe('2026-12-06');
    expect(critterArt(critter, { category: 'gym', now: hanukkah }).holiday).toBe(true);
    expect(critterArt(critter, { category: 'gym', now: new Date(2026, 9, 20, 12) }).holiday).toBe(false);
  });
});
