import { CHEEK, INK, darken, lighten, mix } from './palette.ts';
import type { Geometry } from './geometry.ts';
import { circle, el, ellipse, g, path } from './svg.ts';
import type { Creature } from './types.ts';

/**
 * Fills with soft 3D lighting: light from the top left, shade toward the bottom right. Each
 * shape gets its own gradient box, so every part of the body looks round on its own.
 * Every id starts with `prefix`: on the web all drawings share one page, and a critter on a
 * hidden screen must not lend its gradients to one on the visible screen.
 */
export class Paint {
  private readonly defs = new Map<string, string>();
  readonly color: string;
  readonly prefix: string;

  constructor(color: string, prefix: string) {
    this.color = color;
    this.prefix = prefix;
  }

  /** A lit fill for `base` (the creature's color by default). */
  fill(base: string = this.color): string {
    const id = `${this.prefix}-v${base.slice(1)}`;
    if (!this.defs.has(id)) {
      this.defs.set(
        id,
        el(
          'radialGradient',
          { id, cx: 0.36, cy: 0.3, r: 0.85 },
          el('stop', { offset: 0, 'stop-color': lighten(base, 0.5) }),
          el('stop', { offset: 0.45, 'stop-color': base }),
          el('stop', { offset: 1, 'stop-color': darken(base, 0.34) }),
        ),
      );
    }
    return `url(#${id})`;
  }

  /** A soft spot of `base` that fades out toward its edge (highlights and shade). */
  glow(base: string, opacity: number): string {
    const id = `${this.prefix}-g${base.slice(1)}${Math.round(opacity * 100)}`;
    if (!this.defs.has(id)) {
      this.defs.set(
        id,
        el(
          'radialGradient',
          { id },
          el('stop', { offset: 0, 'stop-color': base, 'stop-opacity': opacity }),
          el('stop', { offset: 1, 'stop-color': base, 'stop-opacity': 0 }),
        ),
      );
    }
    return `url(#${id})`;
  }

  /** Registers a clip path once and returns its reference. */
  clip(id: string, d: string): string {
    if (!this.defs.has(id)) this.defs.set(id, el('clipPath', { id }, path(d)));
    return `url(#${id})`;
  }

  markup(): string {
    return this.defs.size ? el('defs', {}, ...this.defs.values()) : '';
  }
}

/** Everything that makes one creature, drawn on the 200 canvas with the ground at y 182. */
export interface CreatureArt {
  geometry: Geometry;
  /** The outline of the body, also used to keep the lighting inside it. */
  body: string;
  /** Behind the body: ears, tails, frills. */
  behind: (p: Paint) => string;
  belly: (p: Paint) => string;
  feet: (p: Paint) => string;
  /** In front of the body and face: arms, nose, beak, spots. */
  front: (p: Paint) => string;
  /** On top of the head, left out when a hat sits there (Mochi's tuft, Ribbit's sprout). */
  crown?: (p: Paint) => string;
}

const rot = (x: number, y: number, deg: number) => `rotate(${deg} ${x} ${y})`;
const oval = (cx: number, cy: number, rx: number, ry: number, fill: string, deg = 0) =>
  ellipse(cx, cy, rx, ry, { fill, transform: deg ? rot(cx, cy, deg) : undefined });
/** The same shape on the right side. */
const mirrored = (markup: string) => g({ transform: 'translate(200 0) scale(-1 1)' }, markup);
const pair = (markup: string) => markup + mirrored(markup);
const pink = (color: string) => mix(color, CHEEK, 0.45);

// Mochi: a lazy dumpling with round ears, stubby feet and paws on its belly.
const mochi: CreatureArt = {
  geometry: { eyeY: 124, eyeGap: 23, mouthY: 143, headTop: 80, headWidth: 84, neckY: 152, neckHalf: 68, left: 30, right: 170 },
  body: 'M42 176 C28 176 26 160 30 146 C38 104 66 78 100 78 C134 78 162 104 170 146 C174 160 172 176 158 176 Z',
  behind: (p) => pair(circle(64, 94, 12, { fill: p.fill() })) + pair(circle(64, 94, 6, { fill: p.fill(mix(p.color, CHEEK, 0.4)) })),
  belly: (p) => oval(100, 158, 40, 21, lighten(p.color, 0.4)),
  feet: (p) => pair(oval(74, 177, 16, 9, p.fill())),
  front: (p) => pair(oval(60, 152, 10, 15, p.fill(), -28)),
  crown: (p) => path('M97 81 C90 64 106 52 118 60 C109 60 104 66 104 80 Z', { fill: darken(p.color, 0.12) }),
};

// Kit: a dramatic fox-cat with tall ears, cheek fluff and a big tail.
const kit: CreatureArt = {
  geometry: { eyeY: 128, eyeGap: 21, mouthY: 150, headTop: 90, headWidth: 70, neckY: 162, neckHalf: 54, left: 42, right: 158 },
  body: 'M100 86 C136 86 158 111 158 141 C158 166 136 180 100 180 C64 180 42 166 42 141 C42 111 64 86 100 86 Z',
  behind: (p) =>
    path('M146 166 C178 164 194 132 180 106 C174 94 160 98 166 112 C172 128 162 146 142 150 Z', { fill: p.fill() }) +
    path('M180 106 C174 94 160 98 166 112 C168 104 174 102 180 106 Z', { fill: lighten(p.color, 0.7) }) +
    pair(path('M60 116 C52 90 54 66 62 50 C78 62 90 78 96 92 Z', { fill: p.fill() })) +
    pair(path('M66 104 C62 88 63 74 67 64 C76 72 83 82 87 92 Z', { fill: p.fill(pink(p.color)) })),
  belly: (p) => oval(100, 162, 30, 16, lighten(p.color, 0.45)),
  feet: (p) => pair(oval(82, 178, 13, 8, p.fill())),
  front: (p) =>
    pair(path('M45 132 L33 128 L42 140 L30 145 L44 152 L36 160 L50 160 Z', { fill: p.fill() })) +
    path('M95 139 L105 139 L100 144 Z', { fill: INK }),
};

// Axo: a cheerful axolotl with frilly gills, spots and little hands.
const axo: CreatureArt = {
  geometry: { eyeY: 124, eyeGap: 27, mouthY: 146, headTop: 92, headWidth: 80, neckY: 160, neckHalf: 56, left: 40, right: 160 },
  body: 'M100 90 C140 90 160 114 160 142 C160 168 138 180 100 180 C62 180 40 168 40 142 C40 114 60 90 100 90 Z',
  behind: (p) => {
    const frill = p.fill(mix(p.color, CHEEK, 0.55));
    return pair(oval(36, 104, 18, 7, frill, -38) + oval(29, 123, 19, 7, frill, -6) + oval(34, 142, 17, 7, frill, 26));
  },
  belly: (p) => oval(100, 162, 34, 15, lighten(p.color, 0.4)),
  feet: (p) => pair(oval(78, 178, 12, 7, p.fill())),
  front: (p) =>
    pair(oval(64, 166, 9, 12, p.fill(), 30)) +
    g({ fill: darken(p.color, 0.18), opacity: 0.5 }, circle(84, 98, 3), circle(100, 95, 3.5), circle(116, 98, 3)),
};

// Ribbit: a calm frog with eye bumps, a moss cap and a sprout.
const ribbit: CreatureArt = {
  geometry: { eyeY: 104, eyeGap: 29, mouthY: 138, headTop: 90, headWidth: 64, neckY: 154, neckHalf: 62, left: 34, right: 166 },
  body:
    'M100 100 C146 100 166 122 166 150 C166 172 146 180 100 180 C54 180 34 172 34 150 C34 122 50 104 64 100 C64 84 88 80 90 98 C94 97 106 97 110 98 C112 80 136 84 136 100 C140 100 100 100 100 100 Z',
  behind: () => '',
  belly: (p) => oval(100, 160, 44, 18, lighten(p.color, 0.4)),
  feet: (p) =>
    pair(path('M46 170 C36 172 30 180 38 182 L48 180 L50 184 L60 181 L64 184 L70 178 C68 170 56 166 46 170 Z', { fill: p.fill() })),
  front: (p) =>
    path('M86 92 C84 80 96 74 104 78 C114 74 122 84 116 92 C108 88 94 88 86 92 Z', { fill: '#8DB87A' }) +
    pair(oval(52, 160, 9, 13, p.fill(), -30)),
  crown: () =>
    path('M100 80 C100 72 101 66 103 60', { fill: 'none', stroke: '#6E9A5B', 'stroke-width': 3.5, 'stroke-linecap': 'round' }) +
    path('M103 61 C96 50 84 53 85 60 C90 65 97 65 103 61 Z', { fill: '#9CC689' }),
};

// Hoot: a nerdy owlet with ear tufts, a face disc, wings and a beak.
const hoot: CreatureArt = {
  geometry: { eyeY: 122, eyeGap: 22, mouthY: 150, headTop: 84, headWidth: 74, neckY: 160, neckHalf: 54, left: 44, right: 156 },
  body: 'M100 80 C138 80 156 108 156 142 C156 168 134 182 100 182 C66 182 44 168 44 142 C44 108 62 80 100 80 Z',
  behind: (p) => pair(path('M64 96 L56 62 L88 86 Z', { fill: p.fill() })),
  belly: (p) =>
    oval(100, 160, 32, 20, lighten(p.color, 0.4)) +
    g(
      { fill: 'none', stroke: darken(p.color, 0.15), 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.6 },
      path('M88 152 l4 4 l4 -4 M104 152 l4 4 l4 -4 M96 164 l4 4 l4 -4'),
    ) +
    pair(circle(78, 122, 20, { fill: lighten(p.color, 0.45), opacity: 0.8 })),
  feet: () =>
    pair(path('M80 176 l-6 8 M84 177 l0 9 M88 176 l6 8', { fill: 'none', stroke: '#E8A15A', 'stroke-width': 4, 'stroke-linecap': 'round' })),
  front: (p) =>
    pair(path('M50 118 C34 134 36 160 54 170 C56 150 58 134 62 124 Z', { fill: p.fill(darken(p.color, 0.12)) })) +
    path('M94 134 L106 134 L100 144 Z', { fill: '#E8A15A' }),
};

// Bun: a shy bunny bean with long ears (one flops over) and a cotton tail.
const bun: CreatureArt = {
  geometry: { eyeY: 130, eyeGap: 20, mouthY: 150, headTop: 96, headWidth: 70, neckY: 162, neckHalf: 50, left: 48, right: 152 },
  body: 'M100 94 C134 94 152 120 152 148 C152 170 132 182 100 182 C68 182 48 170 48 148 C48 120 66 94 100 94 Z',
  behind: (p) =>
    circle(152, 160, 12, { fill: lighten(p.color, 0.6) }) +
    oval(80, 62, 12, 32, p.fill(), -8) +
    oval(80, 64, 6, 24, p.fill(mix(p.color, CHEEK, 0.4)), -8) +
    oval(130, 74, 12, 32, p.fill(), 55) +
    oval(130, 75, 6, 24, p.fill(mix(p.color, CHEEK, 0.4)), 55),
  belly: (p) => oval(100, 164, 30, 15, lighten(p.color, 0.45)),
  feet: (p) => pair(oval(80, 179, 17, 7, p.fill())),
  front: () => path('M96 140 Q100 144 104 140 Q100 137 96 140 Z', { fill: '#E98B8B' }),
};

export const CREATURE_ART: Record<Creature, CreatureArt> = { mochi, kit, axo, ribbit, hoot, bun };

/** Each creature's own color (the owner's picks, September 2026). */
export const CREATURE_COLORS: Record<Creature, string> = {
  mochi: '#F4B585',
  kit: '#F5D77A',
  axo: '#A8D2EE',
  ribbit: '#9CCB85',
  hoot: '#8A6247',
  bun: '#F3EFE9',
};

/** Lighting inside the body outline: a soft highlight up top and shade along the bottom. */
export function bodyLight(creature: Creature, p: Paint): string {
  const art = CREATURE_ART[creature];
  return g(
    { 'clip-path': p.clip(`${p.prefix}-clip-${creature}`, art.body) },
    ellipse(100, 190, 80, 24, { fill: p.glow(darken(p.color, 0.55), 0.4) }),
    ellipse(80, 104, 22, 14, { fill: p.glow('#FFFFFF', 0.85), transform: rot(80, 104, -20) }),
  );
}
