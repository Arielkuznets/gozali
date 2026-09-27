import type { Stage } from '@gozali/game-engine';

import { CREATURE_ART, Paint, bodyLight } from './creatures.ts';
import { drawFace, type Face } from './face.ts';
import { GROUND } from './geometry.ts';
import {
  EGG,
  aura,
  background,
  bandage,
  behindBody,
  blanket,
  categoryItem,
  headItem,
  hearts,
  medal,
  neckItem,
  note,
  plate,
  rumble,
  snore,
  sparkles,
  sweat,
} from './items.ts';
import { INK, darken, lighten, mix } from './palette.ts';
import { ellipse, g, line, path, scaleAround } from './svg.ts';
import type { CritterArt, Species } from './types.ts';

/** Body size per stage; the egg has its own drawing. */
const STAGE_SCALE: Record<Stage, number> = { egg: 1, baby: 0.62, kid: 0.74, teen: 0.86, adult: 0.95, legend: 1 };
/** Young critters get bigger eyes for their size. */
const EYE_SCALE: Record<Stage, number> = { egg: 1, baby: 1.25, kid: 1.12, teen: 1.05, adult: 1, legend: 1 };

const LEVELS = ['sick', 'weak', 'hungry', 'happy', 'thriving'] as const;
type Level = (typeof LEVELS)[number];

const FACES: Record<Level, Face> = {
  thriving: { eyes: 'sparkle', mouth: 'grin', brows: 'none', cheeks: true },
  happy: { eyes: 'open', mouth: 'smile', brows: 'none', cheeks: true },
  hungry: { eyes: 'down', mouth: 'o', brows: 'worried', cheeks: false },
  weak: { eyes: 'droopy', mouth: 'wavy', brows: 'sad', cheeks: false },
  sick: { eyes: 'tired', mouth: 'wavy', brows: 'sad', cheeks: false },
};

/** Each creature's personality in its faces (spec section 4). */
function faceFor(level: Level, species: Species): Face {
  const face = FACES[level];
  switch (species) {
    case 'mochi':
      // Too lazy to open its eyes all the way when things are great.
      return level === 'thriving' ? { ...face, eyes: 'happy' } : face;
    case 'kit':
      if (level === 'happy' || level === 'thriving') return { ...face, brows: 'proud' };
      // Not hungry, offended.
      return level === 'hungry' ? { ...face, eyes: 'lidded', mouth: 'flat', brows: 'offended' } : face;
    case 'axo':
      return level === 'happy' ? { ...face, mouth: 'grin' } : face;
    case 'ribbit':
      return level === 'hungry' ? { ...face, mouth: 'flat' } : face;
    case 'hoot':
      return level === 'happy' ? { ...face, mouth: 'flat' } : face;
    case 'bun':
      return level === 'happy' || level === 'thriving' ? { ...face, eyes: 'happy' } : face;
  }
}

/** Everyone fed today lifts the face one level; the body still shows the health state. */
function levelOf(art: CritterArt & { look: Level }): Level {
  return LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(art.look) + ((art.mood ?? 0) >= 1 ? 1 : 0))] ?? art.look;
}

/** The face for the day: health, today's mood, sleep, sickness and a yawn. */
function faceOf(art: CritterArt & { look: Level }): Face {
  const sleeping = art.sleeping ?? false;
  let face = faceFor(levelOf(art), art.species);
  if ((art.mood ?? 0) >= 0.5 && art.look !== 'sick') face = { ...face, cheeks: true };
  if (sleeping) face = { eyes: 'closed', mouth: 'sleep', brows: 'none', cheeks: face.cheeks };
  if (art.look === 'sick' && !sleeping) face = { ...face, mouth: 'thermometer' };
  else if (art.yawning && !sleeping) face = { ...face, eyes: 'squeezed', mouth: 'yawn', brows: 'none' };
  return face;
}

/** The creature's color on a bad day: faded when weak, greenish when sick. */
function bodyColor(art: CritterArt): string {
  if (art.look === 'weak') return mix(art.color, '#D8D2CB', 0.45);
  if (art.look === 'sick') return mix(art.color, '#CFE0B8', 0.35);
  return art.color;
}

function drawCritter(art: CritterArt & { look: Level }, p: Paint): string {
  const creature = CREATURE_ART[art.species];
  const geometry = creature.geometry;
  const outfit = art.outfit ?? {};
  const sleeping = art.sleeping ?? false;
  const scale = STAGE_SCALE[art.stage];
  const marks = art.marks ?? [];
  // Sleep wins over a holiday, and a holiday over the outfit (spec section 4).
  const head = sleeping ? 'nightcap' : art.holiday ? 'party_hat' : outfit.head;

  const body = [
    behindBody(outfit.neck, geometry),
    creature.behind(p),
    path(creature.body, { fill: p.fill() }),
    creature.belly(p),
    bodyLight(art.species, p),
    creature.feet(p),
    drawFace(faceOf(art), geometry, {
      eyeScale: EYE_SCALE[art.stage],
      blinking: art.blinking ?? false,
      gaze: sleeping ? undefined : art.gaze,
      skin: p.color,
      shadow: darken(p.color, 0.25),
    }),
    creature.front(p),
    // A hat covers Mochi's tuft and Ribbit's sprout.
    head ? '' : (creature.crown?.(p) ?? ''),
    outfit.neck ? neckItem(outfit.neck, geometry) : '',
    marks.includes('medal') ? medal(geometry) : '',
    art.look === 'sick' ? blanket(geometry) : '',
    art.categoryItem ? categoryItem(art.categoryItem, geometry) : '',
    head ? headItem(head, geometry) : '',
    marks.includes('bandage') ? bandage(geometry) : '',
    art.look === 'sick' ? sweat(geometry) : '',
    art.look === 'hungry' ? rumble(geometry) + plate(geometry) : '',
  ].join('');

  // Weak critters slump to one side.
  const pose = art.look === 'weak' ? `rotate(-6 100 ${GROUND}) ${scaleAround(100, GROUND, 1.06, 0.9)}` : '';

  return [
    art.stage === 'legend' ? aura(p.prefix) : '',
    ellipse(100, GROUND + 2, 58 * scale, 7, { fill: p.glow(INK, 0.22) }),
    g({ transform: `${pose} ${scaleAround(100, GROUND, scale)}`.trim() }, body),
    !sleeping && levelOf(art) === 'thriving' ? sparkles() : '',
    !sleeping && (art.mood ?? 0) >= 1 ? hearts() : '',
    sleeping ? snore() : '',
  ].join('');
}

/** The egg, in the creature's color and lit like its body; it cracks once the second member joined. */
function drawEgg(color: string, cracking: boolean, p: Paint): string {
  return (
    ellipse(100, 185, 44, 5, { fill: p.glow(INK, 0.22) }) +
    path(EGG, { fill: p.fill(lighten(color, 0.2)) }) +
    g({ fill: darken(color, 0.12), opacity: 0.55 }, ellipse(80, 104, 8, 10), ellipse(120, 132, 11, 9), ellipse(86, 158, 6, 5), ellipse(128, 96, 4, 5)) +
    (cracking ? path('M62 126 L74 118 L84 130 L96 119 L106 132 L118 121 L128 131 L138 124', line(INK, 3)) : '')
  );
}

/**
 * The critter as a standalone SVG document on a 200 x 200 canvas. `id` starts every id inside
 * it; give each critter on a web page its own.
 */
export function renderCritter(art: CritterArt, options: { id?: string } = {}): string {
  const p = new Paint(bodyColor(art), options.id ?? 'gz');
  let content: string;
  if (art.look === 'egg') content = drawEgg(art.color, art.cracking ?? false, p);
  else if (art.look === 'ran_away') content = note();
  else content = drawCritter({ ...art, look: art.look }, p);
  const backdrop = art.outfit?.background ? background(art.outfit.background, p.prefix) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${p.markup()}${backdrop}${content}</svg>`;
}
