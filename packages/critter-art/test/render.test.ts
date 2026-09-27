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

test('the holiday calendar has the known dates', async () => {
  const { isHoliday } = await import('../src/index.ts');
  assert.ok(isHoliday('2026-09-12') && isHoliday('2026-09-13'), 'Rosh Hashanah 2026');
  assert.ok(isHoliday('2026-12-05') && isHoliday('2026-12-12') && !isHoliday('2026-12-13'), 'Hanukkah 2026, eight days');
  assert.ok(isHoliday('2027-03-23'), 'Purim 2027 (Adar II)');
  assert.ok(isHoliday('2027-04-22') && isHoliday('2027-04-28'), 'Passover 2027');
  assert.ok(isHoliday('2030-01-01') && !isHoliday('2026-10-20'), 'New Year yes, an ordinary day no');
});

test('the holiday hat replaces the head item, but not the nightcap', () => {
  const art: CritterArt = { species: 'blob', color: CRITTER_PALETTE.peach, stage: 'kid', look: 'happy', outfit: { head: 'beanie' } };
  const holiday = renderCritter({ ...art, holiday: true });
  assert.doesNotMatch(holiday, /#D96C5F/, 'no beanie');
  assert.match(holiday, /#F7E3A1/, 'the party hat');
  assert.match(renderCritter({ ...art, holiday: true, sleeping: true }), /#8FA8D8/, 'asleep: the nightcap');
});

test('a yawn changes the face, but not in sleep or when sick', () => {
  const art: CritterArt = { species: 'blob', color: CRITTER_PALETTE.peach, stage: 'kid', look: 'happy' };
  const yawn = renderCritter({ ...art, yawning: true });
  assert.notEqual(yawn, renderCritter(art));
  assert.ok(balanced(yawn));
  assert.equal(renderCritter({ ...art, sleeping: true, yawning: true }), renderCritter({ ...art, sleeping: true }));
  assert.equal(renderCritter({ ...art, look: 'sick', yawning: true }), renderCritter({ ...art, look: 'sick' }));
});

test('the eyes follow a gaze and stay put without one', () => {
  const art: CritterArt = { species: 'mossy', color: CRITTER_PALETTE.sage, stage: 'teen', look: 'happy' };
  assert.notEqual(renderCritter({ ...art, gaze: { x: 1, y: 0 } }), renderCritter(art));
  assert.equal(renderCritter({ ...art, gaze: { x: 0, y: 0 } }), renderCritter(art));
});
