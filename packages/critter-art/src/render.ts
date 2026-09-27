import type { Stage } from '@gozali/game-engine';

import { drawFace, type Face } from './face.ts';
import {
  aura,
  background,
  bandage,
  behindBody,
  blanket,
  categoryItem,
  egg,
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
import { INK, darken, mix } from './palette.ts';
import { GROUND, SPECIES_ART } from './species.ts';
import { ellipse, g, scaleAround } from './svg.ts';
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

/** Personality on top of the shared faces (spec section 4). */
function faceFor(level: Level, species: Species): Face {
  const face = FACES[level];
  if (species === 'blob') {
    // Too lazy to open its eyes all the way when things are great.
    if (level === 'thriving') return { ...face, eyes: 'happy' };
  }
  if (species === 'spark') {
    if (level === 'happy' || level === 'thriving') return { ...face, brows: 'proud' };
    // Not hungry, offended.
    if (level === 'hungry') return { ...face, eyes: 'lidded', mouth: 'flat', brows: 'offended' };
  }
  if (species === 'mossy' && level === 'hungry') return { ...face, mouth: 'flat' };
  return face;
}

function drawCritter(art: CritterArt & { look: Level }): string {
  const species = SPECIES_ART[art.species];
  const geometry = species.geometry;
  const outfit = art.outfit ?? {};
  const mood = art.mood ?? 0;
  const everyoneFed = mood >= 1;
  const sleeping = art.sleeping ?? false;

  // Everyone fed today lifts the face one level; the body still shows the health state.
  const level = LEVELS[Math.min(LEVELS.length - 1, LEVELS.indexOf(art.look) + (everyoneFed ? 1 : 0))] ?? art.look;
  let face = faceFor(level, art.species);
  if (mood >= 0.5 && art.look !== 'sick') face = { ...face, cheeks: true };
  if (sleeping) face = { eyes: 'closed', mouth: 'sleep', brows: 'none', cheeks: face.cheeks };
  if (art.look === 'sick' && !sleeping) face = { ...face, mouth: 'thermometer' };
  else if (art.yawning && !sleeping) face = { ...face, eyes: 'squeezed', mouth: 'yawn', brows: 'none' };

  const color =
    art.look === 'weak' ? mix(art.color, '#D8D2CB', 0.45) : art.look === 'sick' ? mix(art.color, '#CFE0B8', 0.35) : art.color;
  const scale = STAGE_SCALE[art.stage];
  const marks = art.marks ?? [];
  // Sleep wins over a holiday, and a holiday over the outfit (spec section 4).
  const head = sleeping ? 'nightcap' : art.holiday ? 'party_hat' : outfit.head;

  const body = [
    behindBody(outfit.neck, geometry),
    species.behind(color),
    species.body(color),
    species.details(color),
    drawFace(face, geometry, {
      eyeScale: EYE_SCALE[art.stage],
      blinking: art.blinking ?? false,
      gaze: sleeping ? undefined : art.gaze,
      skin: color,
      shadow: darken(color, 0.25),
      buckTooth: art.species === 'mossy',
    }),
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
    art.stage === 'legend' ? aura() : '',
    ellipse(100, GROUND + 2, 56 * scale, 6, { fill: INK, opacity: 0.08 }),
    g({ transform: `${pose} ${scaleAround(100, GROUND, scale)}`.trim() }, body),
    !sleeping && level === 'thriving' ? sparkles() : '',
    !sleeping && everyoneFed ? hearts() : '',
    sleeping ? snore() : '',
  ].join('');
}

/** The critter as a standalone SVG document on a 200 x 200 canvas. */
export function renderCritter(art: CritterArt): string {
  let content: string;
  if (art.look === 'egg') content = egg(art.color, art.cracking ?? false);
  else if (art.look === 'ran_away') content = note();
  else content = drawCritter({ ...art, look: art.look });
  const backdrop = art.outfit?.background ? background(art.outfit.background) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${backdrop}${content}</svg>`;
}
