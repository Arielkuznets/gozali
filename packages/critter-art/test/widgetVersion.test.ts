import assert from 'node:assert/strict';
import { test } from 'node:test';

import { artVersion } from '../../../supabase/functions/widget-state/state.ts';
import { CREATURE_COLORS, CREATURES, renderCritter, type CritterArt } from '../src/index.ts';

/** Hungry on purpose: a happy critter already has cheeks, so the half-fed step draws nothing for it. */
function art(mood: number, changes: Partial<CritterArt> = {}): CritterArt {
  return { species: 'mochi', color: CREATURE_COLORS.mochi, stage: 'adult', look: 'hungry', mood, sleeping: false, outfit: {}, marks: [], ...changes };
}

test('the same drawing keeps its address when the fed count moves', () => {
  assert.equal(artVersion(art(1 / 8)), artVersion(art(3 / 8)));
  assert.equal(artVersion(art(1 / 2)), artVersion(art(7 / 8)));
});

test('a different drawing gets a different address', () => {
  assert.notEqual(artVersion(art(3 / 8)), artVersion(art(1 / 2)));
  assert.notEqual(artVersion(art(7 / 8)), artVersion(art(1)));
  assert.notEqual(artVersion(art(1 / 2)), artVersion(art(1 / 2, { sleeping: true })));
  assert.notEqual(artVersion(art(1 / 2)), artVersion(art(1 / 2, { stage: 'legend' })));
  assert.notEqual(artVersion(art(1 / 2)), artVersion(art(1 / 2, { outfit: { head: 'crown' } })));
});

test('two moods share an address exactly when they draw the same', () => {
  const looks = ['thriving', 'happy', 'hungry', 'weak', 'sick', 'ran_away', 'egg'] as const;
  const moods = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 2 / 3, 7 / 8, 1];
  for (const species of CREATURES)
    for (const look of looks)
      for (const sleeping of [false, true]) {
        const drawings = moods.map((mood) => {
          const drawn = art(mood, { species, color: CREATURE_COLORS[species], look, sleeping });
          return { mood, version: artVersion(drawn), svg: renderCritter(drawn) };
        });
        for (const one of drawings)
          for (const other of drawings)
            assert.equal(one.version === other.version, one.svg === other.svg, `${species} ${look} sleeping ${sleeping}: moods ${one.mood} and ${other.mood}`);
      }
});
