import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CRITTER_PALETTE, renderCritter, type CritterArt } from '../src/index.ts';

const species = ['blob', 'spark', 'mossy'] as const;
const stages = ['baby', 'kid', 'teen', 'adult', 'legend'] as const;
const looks = ['thriving', 'happy', 'hungry', 'weak', 'sick', 'ran_away'] as const;

/** Every opened tag is closed, in order. */
function balanced(svg: string): boolean {
  const stack: string[] = [];
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return false;
    } else stack.push(name ?? '');
  }
  return stack.length === 0;
}

function* everyCritter(): Generator<CritterArt> {
  for (const s of species)
    for (const stage of stages)
      for (const look of looks)
        for (const sleeping of [false, true])
          yield {
            species: s,
            stage,
            look,
            sleeping,
            color: CRITTER_PALETTE.sky,
            mood: 1,
            blinking: true,
            outfit: { head: 'beanie', neck: 'cape', background: 'space' },
            marks: ['medal', 'bandage'],
            categoryItem: 'headphones',
          };
}

test('every combination renders well-formed markup with real numbers', () => {
  for (const art of everyCritter()) {
    const svg = renderCritter(art);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${art.species} ${art.stage} ${art.look}`);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    assert.ok(balanced(svg), `unbalanced tags for ${art.species} ${art.stage} ${art.look}`);
  }
});

test('the same state always gives the same drawing', () => {
  const art: CritterArt = { species: 'spark', color: CRITTER_PALETTE.peach, stage: 'kid', look: 'hungry' };
  assert.equal(renderCritter(art), renderCritter({ ...art }));
});

test('the egg cracks only once asked to', () => {
  const egg: CritterArt = { species: 'blob', color: CRITTER_PALETTE.sand, stage: 'egg', look: 'egg' };
  assert.notEqual(renderCritter(egg), renderCritter({ ...egg, cracking: true }));
});

test('sleeping swaps the head item for a nightcap', () => {
  const art: CritterArt = { species: 'mossy', color: CRITTER_PALETTE.sage, stage: 'teen', look: 'happy', outfit: { head: 'halo' } };
  const awake = renderCritter(art);
  const asleep = renderCritter({ ...art, sleeping: true });
  assert.match(awake, /#F2C94C/);
  assert.doesNotMatch(asleep, /#F2C94C/);
  assert.match(asleep, /#8FA8D8/);
});

test('everyone fed today brightens the face of a hungry critter', () => {
  const hungry: CritterArt = { species: 'blob', color: CRITTER_PALETTE.peach, stage: 'kid', look: 'hungry' };
  assert.notEqual(renderCritter(hungry), renderCritter({ ...hungry, mood: 1 }));
});

test('every wardrobe item an achievement unlocks has a drawing in its slot', async () => {
  const { ACHIEVEMENTS } = await import('@gozali/game-engine');
  const { BACKGROUND_ITEMS, HEAD_ITEMS, NECK_ITEMS } = await import('../src/index.ts');
  const drawn: Record<string, readonly string[]> = { head: HEAD_ITEMS, neck: NECK_ITEMS, background: BACKGROUND_ITEMS };
  for (const { item } of ACHIEVEMENTS) {
    assert.ok(drawn[item.slot]?.includes(item.key), `${item.key} (${item.slot})`);
  }
});
