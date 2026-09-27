import { CHEEK, darken, lighten, mix } from './palette.ts';
import { ellipse, g, line, path } from './svg.ts';
import type { OldSpecies } from './types.ts';

/** Where the face and the worn items sit on a full-size body (viewBox 200, ground at y 182). */
export interface Geometry {
  eyeY: number;
  /** Distance of each eye from the center line. */
  eyeGap: number;
  mouthY: number;
  headTop: number;
  headWidth: number;
  neckY: number;
  neckHalf: number;
  left: number;
  right: number;
}

export const GROUND = 182;

interface SpeciesArt {
  geometry: Geometry;
  /** Parts behind the body, like ears and a tail. */
  behind: (color: string) => string;
  body: (color: string) => string;
  /** Details on top of the body: belly, spots and the species' small flaw. */
  details: (color: string) => string;
}

// Blob: a lazy, soft dome with a cowlick that never stays down.
const blob: SpeciesArt = {
  geometry: {
    eyeY: 122,
    eyeGap: 21,
    mouthY: 142,
    headTop: 77,
    headWidth: 76,
    neckY: 153,
    neckHalf: 61,
    left: 36,
    right: 164,
  },
  behind: () => '',
  body: (color) =>
    path('M46 182 C33 182 33 168 36 156 C43 107 68 76 100 76 C132 76 157 107 164 156 C167 168 167 182 154 182 Z', {
      fill: color,
    }),
  details: (color) =>
    ellipse(100, 164, 40, 15, { fill: lighten(color, 0.35) }) +
    path('M97 79 C90 62 106 50 118 58 C109 58 104 64 104 78 Z', { fill: darken(color, 0.1) }),
};

// Spark: dramatic, with pointy ears (the right one flops over) and a zigzag tail.
const spark: SpeciesArt = {
  geometry: {
    eyeY: 128,
    eyeGap: 20,
    mouthY: 150,
    headTop: 88,
    headWidth: 66,
    neckY: 161,
    neckHalf: 52,
    left: 46,
    right: 154,
  },
  behind: (color) =>
    path('M138 158 L166 148 L158 163 L184 154', line(darken(color, 0.12), 8)) +
    path('M62 120 L60 64 L98 94 Z', { ...line(color, 10), fill: color }) +
    path('M67 108 L66 80 L86 95 Z', { fill: mix(color, CHEEK, 0.45) }) +
    path('M104 94 L136 70 Q146 64 156 72 L170 90 L152 88 L146 116 Z', { ...line(color, 10), fill: color }) +
    path('M152 76 L164 90 L152 88 Z', { fill: darken(color, 0.1) }),
  body: (color) =>
    path('M100 86 C134 86 154 110 154 140 C154 166 132 182 100 182 C68 182 46 166 46 140 C46 110 66 86 100 86 Z', {
      fill: color,
    }),
  details: (color) => ellipse(100, 166, 34, 13, { fill: lighten(color, 0.35) }),
};

// Mossy: a calm, square-ish stump with a sprout, a few moss spots and a buck tooth.
const mossy: SpeciesArt = {
  geometry: {
    eyeY: 122,
    eyeGap: 22,
    mouthY: 145,
    headTop: 87,
    headWidth: 96,
    neckY: 157,
    neckHalf: 57,
    left: 44,
    right: 156,
  },
  behind: () => '',
  body: (color) =>
    path('M72 86 H128 C146 86 156 97 156 114 V160 C156 174 146 182 132 182 H68 C54 182 44 174 44 160 V114 C44 97 54 86 72 86 Z', {
      fill: color,
    }),
  details: (color) =>
    g(
      { fill: darken(color, 0.14), opacity: 0.45 },
      ellipse(68, 100, 9, 5),
      ellipse(130, 97, 11, 5),
      ellipse(147, 124, 4, 7),
    ) +
    ellipse(100, 166, 42, 12, { fill: lighten(color, 0.35) }) +
    path('M100 88 C100 78 101 71 103 64', line('#6E9A5B', 4)) +
    path('M103 65 C95 52 82 55 83 63 C89 68 97 68 103 65 Z', { fill: '#8DB87A' }) +
    path('M103 63 C109 50 124 51 123 59 C118 66 109 66 103 63 Z', { fill: '#9CC689' }),
};

export const SPECIES_ART: Record<OldSpecies, SpeciesArt> = { blob, spark, mossy };
