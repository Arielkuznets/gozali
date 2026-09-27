import { ACCENT, GOLD, INK, WHITE, darken, lighten } from './palette.ts';
import { GROUND, type Geometry } from './geometry.ts';
import { circle, el, ellipse, g, line, path, rect } from './svg.ts';
import type { BackgroundItem, CategoryItem, HeadItem, NeckItem } from './types.ts';

// Head items are drawn for a head 80 wide with the origin at the top center of the head,
// then scaled to each species. Neck items are drawn for a neck 110 wide.
const HEAD_WIDTH = 80;
const NECK_HALF = 55;

const flower = (x: number, y: number, petals: string) =>
  g(
    { transform: `translate(${x} ${y})` },
    ...[0, 72, 144, 216, 288].map((angle) => circle(0, -4, 3.6, { fill: petals, transform: `rotate(${angle})` })),
    circle(0, 0, 2.6, { fill: GOLD }),
  );

const HEAD_ITEMS: Record<HeadItem | 'nightcap' | 'party_hat', string> = {
  beanie:
    path('M-38 10 C-40 -30 40 -30 38 10 Z', { fill: '#D96C5F' }) +
    g({ ...line('#C25A4E', 2) }, path('M-20 -14 L-22 2'), path('M0 -20 L0 2'), path('M20 -14 L22 2')) +
    rect(-42, 0, 84, 13, { rx: 6.5, fill: '#C25A4E' }) +
    circle(0, -24, 8, { fill: '#F3E9DC' }),
  flower_crown:
    path('M-40 6 Q0 -6 40 6', line('#7FA36B', 3)) +
    flower(-32, 3, '#F2B8C6') +
    flower(-16, -1, '#F7E3A1') +
    flower(0, -3, '#BCD9E8') +
    flower(16, -1, '#F2B8C6') +
    flower(32, 3, '#F7E3A1'),
  sun_hat:
    ellipse(0, 6, 60, 12, { fill: '#F1D9A6', stroke: darken('#F1D9A6', 0.15), 'stroke-width': 1.5 }) +
    path('M-28 6 C-28 -26 28 -26 28 6 Z', { fill: '#F1D9A6', stroke: darken('#F1D9A6', 0.15), 'stroke-width': 1.5 }) +
    rect(-28, -5, 56, 8, { fill: ACCENT }) +
    flower(22, -1, '#FFFFFF'),
  headlamp:
    circle(0, 8, 16, { fill: '#FFF3B0', opacity: 0.55 }) +
    rect(-42, 12, 84, 8, { rx: 4, fill: '#4A4A5A' }) +
    rect(-10, 4, 20, 16, { rx: 5, fill: '#F5F2EA', stroke: '#4A4A5A', 'stroke-width': 2 }) +
    circle(0, 12, 4.5, { fill: '#FFE27A' }),
  halo:
    ellipse(0, -16, 30, 8, { ...line(GOLD, 5) }) + ellipse(0, -16, 30, 8, { ...line('#FFF3B0', 1.5), opacity: 0.8 }),
  party_hat:
    path('M-24 10 L2 -46 L26 10 Z', { fill: '#F7E3A1' }) +
    g(
      { ...line(ACCENT, 5) },
      path('M-15 -9 L13 -9'),
      path('M-7 -28 L6 -28'),
    ) +
    g({ fill: '#BCD9E8' }, circle(-10, 2, 3), circle(12, -16, 2.6), circle(-2, -36, 2)) +
    path('M-26 10 Q0 18 28 10', line(darken('#F7E3A1', 0.25), 3)) +
    circle(2, -48, 6, { fill: '#F2B8C6' }),
  nightcap:
    path('M-38 12 C-32 -26 8 -44 48 -20 C30 -22 14 -14 36 12 Z', { fill: '#8FA8D8' }) +
    g({ fill: '#FFFFFF', opacity: 0.55 }, circle(-18, -6, 2.5), circle(4, -16, 2), circle(-4, 2, 2.2), circle(22, -10, 1.8)) +
    rect(-42, 2, 82, 12, { rx: 6, fill: '#7890C4' }) +
    circle(48, -20, 7.5, { fill: WHITE }),
};

const NECK_ITEMS: Record<NeckItem, string> = {
  scarf:
    path('M-52 -7 Q0 9 52 -7 L50 6 Q0 22 -50 6 Z', { fill: ACCENT }) +
    path('M20 8 L27 38 L40 35 L36 4 Z', { fill: '#D8664A' }) +
    g({ ...line('#F6C9A8', 2.5) }, path('M24 20 L37 18'), path('M26 29 L38 27'), path('M-30 3 Q-20 6 -10 7')),
  bow_tie:
    path('M0 2 L-19 -9 Q-22 2 -19 13 Z', { fill: '#D95F5F' }) +
    path('M0 2 L19 -9 Q22 2 19 13 Z', { fill: '#D95F5F' }) +
    circle(0, 2, 5.5, { fill: '#B84A4A' }),
  cape: circle(0, 0, 6, { fill: GOLD, stroke: darken(GOLD, 0.3), 'stroke-width': 1.5 }),
};

/** The cape's cloth hangs behind the body; its clasp is a neck item. */
function capeBehind(geometry: Geometry): string {
  const { neckY, neckHalf } = geometry;
  const w = neckHalf + 6;
  return path(
    `M${100 - w} ${neckY - 6} Q100 ${neckY + 8} ${100 + w} ${neckY - 6} L${100 + w + 20} ${GROUND + 2} Q100 ${GROUND + 12} ${100 - w - 20} ${GROUND + 2} Z`,
    { fill: '#C0504D' },
  );
}

export function headItem(item: HeadItem | 'nightcap' | 'party_hat', geometry: Geometry): string {
  const scale = geometry.headWidth / HEAD_WIDTH;
  return g({ transform: `translate(100 ${geometry.headTop}) scale(${scale})` }, HEAD_ITEMS[item]);
}

export function neckItem(item: NeckItem, geometry: Geometry): string {
  const scale = geometry.neckHalf / NECK_HALF;
  return g({ transform: `translate(100 ${geometry.neckY}) scale(${scale})` }, NECK_ITEMS[item]);
}

export function behindBody(neck: NeckItem | undefined, geometry: Geometry): string {
  return neck === 'cape' ? capeBehind(geometry) : '';
}

export function categoryItem(item: CategoryItem, geometry: Geometry): string {
  const { eyeY, eyeGap, headTop, left, right } = geometry;
  switch (item) {
    case 'dumbbell':
      return g(
        { transform: `translate(${right + 6} ${GROUND - 7}) rotate(-8)` },
        rect(-2, -2.5, 30, 5, { rx: 2.5, fill: '#8A8F98' }),
        rect(-6, -9, 8, 18, { rx: 3, fill: '#4A4F5A' }),
        rect(24, -9, 8, 18, { rx: 3, fill: '#4A4F5A' }),
      );
    case 'glasses':
      return g(
        { ...line(INK, 2.6) },
        circle(100 - eyeGap, eyeY, 13, { fill: WHITE, 'fill-opacity': 0.18 }),
        circle(100 + eyeGap, eyeY, 13, { fill: WHITE, 'fill-opacity': 0.18 }),
        path(`M${100 - eyeGap + 13} ${eyeY - 2} Q100 ${eyeY - 6} ${100 + eyeGap - 13} ${eyeY - 2}`),
      );
    case 'headphones': {
      const side = eyeGap + 30;
      return (
        path(`M${100 - side + 2} ${eyeY - 4} C${100 - side} ${headTop - 22} ${100 + side} ${headTop - 22} ${100 + side - 2} ${eyeY - 4}`, line('#4A4F5A', 5)) +
        rect(100 - side - 6, eyeY - 12, 12, 22, { rx: 6, fill: ACCENT }) +
        rect(100 + side - 6, eyeY - 12, 12, 22, { rx: 6, fill: ACCENT })
      );
    }
    case 'sneakers': {
      const shoe = (x: number) =>
        g(
          { transform: `translate(${x} ${GROUND})` },
          path('M-14 0 C-14 -9 -6 -11 0 -9 C6 -7 14 -6 14 0 Z', { fill: WHITE, stroke: INK, 'stroke-width': 1.2 }),
          path('M-9 -5 L3 -5', line(ACCENT, 2.4)),
          rect(-14, -1.5, 28, 3, { rx: 1.5, fill: ACCENT }),
        );
      return shoe(78) + shoe(122);
    }
    case 'bottle':
      return g(
        { transform: `translate(${left - 14} ${GROUND})` },
        rect(-8, -34, 16, 34, { rx: 5, fill: '#BCD9E8', stroke: darken('#BCD9E8', 0.3), 'stroke-width': 1.5 }),
        rect(-5, -40, 10, 7, { rx: 2, fill: '#5B8DB8' }),
        rect(-8, -20, 16, 8, { fill: WHITE, opacity: 0.6 }),
      );
  }
}

export function medal(geometry: Geometry): string {
  const x = 100 - geometry.neckHalf * 0.38;
  const y = geometry.neckY + 16;
  return (
    path(`M${x - 6} ${y - 16} L${x} ${y - 4} L${x + 6} ${y - 16}`, line('#5B8DB8', 4)) +
    circle(x, y, 7.5, { fill: GOLD, stroke: darken(GOLD, 0.3), 'stroke-width': 1.2 }) +
    path(`M${x} ${y - 3.5} L${x + 1.2} ${y - 0.8} L${x + 3.5} ${y - 0.5} L${x + 1.7} ${y + 1.2} L${x + 2.2} ${y + 3.6} L${x} ${y + 2.3} L${x - 2.2} ${y + 3.6} L${x - 1.7} ${y + 1.2} L${x - 3.5} ${y - 0.5} L${x - 1.2} ${y - 0.8} Z`, {
      fill: lighten(GOLD, 0.5),
    })
  );
}

export function bandage(geometry: Geometry): string {
  const x = 100 + geometry.headWidth * 0.3;
  const y = geometry.eyeY - 22;
  return g(
    { transform: `translate(${x} ${y}) rotate(35)` },
    rect(-13, -4.5, 26, 9, { rx: 4.5, fill: '#F3D9B1', stroke: darken('#F3D9B1', 0.25), 'stroke-width': 1 }),
    rect(-4, -4.5, 8, 9, { fill: '#E9C99A' }),
    g({ fill: darken('#F3D9B1', 0.3) }, circle(-8, -1, 0.8), circle(-8, 1.5, 0.8), circle(8, -1, 0.8), circle(8, 1.5, 0.8)),
  );
}

const star = (x: number, y: number, r: number, fill: string) =>
  path(`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`, { fill });

const heart = (x: number, y: number, size: number) =>
  path(
    `M${x} ${y + size * 0.9} C${x - size * 1.4} ${y} ${x - size * 0.8} ${y - size * 0.9} ${x} ${y - size * 0.25} C${x + size * 0.8} ${y - size * 0.9} ${x + size * 1.4} ${y} ${x} ${y + size * 0.9} Z`,
    { fill: '#E98B8B' },
  );

export const sparkles = () =>
  star(38, 70, 7, GOLD) + star(160, 60, 9, GOLD) + star(170, 118, 5, '#FFFFFF') + star(28, 128, 5, GOLD);

export const hearts = () => heart(158, 78, 7) + heart(40, 92, 5);

export function plate(geometry: Geometry): string {
  const x = geometry.left - 8;
  return (
    ellipse(x, GROUND - 2, 18, 5.5, { fill: WHITE, stroke: darken(WHITE, 0.2), 'stroke-width': 1.5 }) +
    ellipse(x, GROUND - 3, 10, 2.8, { fill: darken(WHITE, 0.06) })
  );
}

export function rumble(geometry: Geometry): string {
  const x = geometry.right - 14;
  const y = GROUND - 30;
  return g({ ...line(INK, 2), opacity: 0.5 }, path(`M${x} ${y} q3 -3 6 0 t6 0`), path(`M${x + 4} ${y + 8} q3 -3 6 0 t6 0`));
}

export function sweat(geometry: Geometry): string {
  const x = 100 - geometry.headWidth * 0.42;
  const y = geometry.eyeY - 16;
  return path(`M${x} ${y - 7} Q${x + 5} ${y} ${x} ${y + 3} Q${x - 5} ${y} ${x} ${y - 7} Z`, {
    fill: '#BCD9E8',
    stroke: darken('#BCD9E8', 0.3),
    'stroke-width': 1,
  });
}

/** A striped blanket over the lower body of a sick critter. */
export function blanket(geometry: Geometry): string {
  const top = geometry.mouthY + 12;
  const x1 = geometry.left - 6;
  const x2 = geometry.right + 6;
  return (
    path(`M${x1} ${GROUND + 2} L${x1 + 4} ${top + 6} Q100 ${top - 6} ${x2 - 4} ${top + 6} L${x2} ${GROUND + 2} Z`, { fill: '#9DB8D9' }) +
    g(
      { ...line('#F7E3A1', 3), opacity: 0.9 },
      path(`M${x1 + 6} ${top + 16} Q100 ${top + 6} ${x2 - 6} ${top + 16}`),
      path(`M${x1 + 4} ${top + 28} Q100 ${top + 18} ${x2 - 4} ${top + 28}`),
    )
  );
}

export const snore = () =>
  g(
    { ...line('#7890C4', 2.6) },
    path('M150 70 h9 l-9 10 h9'),
    path('M166 50 h7 l-7 8 h7'),
    path('M178 34 h5 l-5 6 h5'),
  );

export const EGG = 'M100 68 C131 68 150 114 150 140 C150 168 128 184 100 184 C72 184 50 168 50 140 C50 114 69 68 100 68 Z';

/** Where the critter used to be: a pinned note and footprints walking off. */
export function note(): string {
  const prints = [
    [118, 176],
    [134, 170],
    [150, 176],
    [166, 170],
    [182, 176],
  ]
    .map(([x, y]) => ellipse(x ?? 0, y ?? 0, 4, 2.6, { fill: INK, opacity: 0.18 }))
    .join('');
  return (
    prints +
    g(
      { transform: 'rotate(-5 90 110)' },
      rect(52, 64, 76, 88, { rx: 6, fill: WHITE, stroke: '#EADFD2', 'stroke-width': 2 }),
      g({ ...line('#C9BBAE', 3) }, path('M64 88 H116'), path('M64 102 H110'), path('M64 116 H114'), path('M64 130 H96')),
      circle(90, 66, 5, { fill: ACCENT }),
    )
  );
}

const BACKGROUNDS: Record<BackgroundItem, string> = {
  sunrise:
    rect(0, 0, 200, 200, { fill: '#FCE6CF' }) +
    rect(0, 90, 200, 110, { fill: '#F9D3B4' }) +
    circle(100, 150, 58, { fill: '#F7B267', opacity: 0.7 }) +
    g({ ...line('#F7B267', 5), opacity: 0.6 }, path('M100 72 V58'), path('M52 96 L42 86'), path('M148 96 L158 86'), path('M30 132 H16'), path('M170 132 H184')) +
    path('M0 158 Q100 140 200 158 V200 H0 Z', { fill: '#F2D6B3' }),
  park:
    rect(0, 0, 200, 200, { fill: '#DCEEF2' }) +
    g({ fill: WHITE, opacity: 0.9 }, ellipse(48, 40, 18, 8), ellipse(62, 36, 12, 8), ellipse(150, 28, 16, 7)) +
    rect(20, 96, 8, 60, { rx: 3, fill: '#A0795A' }) +
    circle(24, 86, 22, { fill: '#8DB87A' }) +
    circle(36, 100, 14, { fill: '#9CC689' }) +
    path('M0 150 Q60 128 120 146 T200 140 V200 H0 Z', { fill: '#BFD8A5' }),
  party:
    rect(0, 0, 200, 200, { fill: '#FFF1E0' }) +
    path('M0 22 Q100 52 200 22', line('#C9BBAE', 1.5)) +
    [20, 44, 68, 92, 116, 140, 164, 188]
      .map((x, i) => {
        const y = 22 + 30 * (1 - ((x - 100) / 100) ** 2) * 0.95;
        const colors = ['#F2B8C6', '#F7E3A1', '#BCD9E8', '#BFD8B8'];
        return path(`M${x - 9} ${y - 2} L${x + 9} ${y - 2} L${x} ${y + 14} Z`, { fill: colors[i % colors.length] ?? GOLD });
      })
      .join('') +
    g(
      {},
      rect(30, 80, 5, 9, { fill: '#E8795A', transform: 'rotate(20 32 84)' }),
      rect(170, 70, 5, 9, { fill: '#BCD9E8', transform: 'rotate(-30 172 74)' }),
      rect(22, 150, 5, 9, { fill: '#F7E3A1', transform: 'rotate(40 24 154)' }),
      rect(176, 140, 5, 9, { fill: '#F2B8C6', transform: 'rotate(-15 178 144)' }),
      circle(150, 100, 3, { fill: '#BFD8B8' }),
      circle(46, 116, 3, { fill: '#F2B8C6' }),
    ),
  space:
    rect(0, 0, 200, 200, { fill: '#2E3350' }) +
    g(
      { fill: WHITE },
      circle(24, 30, 1.6),
      circle(70, 18, 1.2),
      circle(120, 40, 1.4),
      circle(178, 88, 1.6),
      circle(20, 96, 1.2),
      circle(160, 150, 1.2),
      circle(40, 160, 1.5),
    ) +
    circle(160, 44, 16, { fill: '#E6A57E' }) +
    ellipse(160, 44, 26, 6, { ...line('#F7E3A1', 2.5), transform: 'rotate(-20 160 44)' }) +
    path('M0 168 Q100 156 200 168 V200 H0 Z', { fill: '#474D6E' }),
};

export function background(item: BackgroundItem, prefix: string): string {
  return (
    el('defs', {}, el('clipPath', { id: `${prefix}-card` }, rect(0, 0, 200, 200, { rx: 28 }))) +
    g({ 'clip-path': `url(#${prefix}-card)` }, BACKGROUNDS[item])
  );
}

export function aura(prefix: string): string {
  return (
    el(
      'defs',
      {},
      el(
        'radialGradient',
        { id: `${prefix}-aura` },
        el('stop', { offset: '0', 'stop-color': GOLD, 'stop-opacity': 0.45 }),
        el('stop', { offset: '1', 'stop-color': GOLD, 'stop-opacity': 0 }),
      ),
    ) + circle(100, 128, 92, { fill: `url(#${prefix}-aura)` })
  );
}
