import { CHEEK, INK, WHITE } from './palette.ts';
import type { Geometry } from './species.ts';
import { circle, ellipse, g, line, path, rect } from './svg.ts';

export type Eyes = 'open' | 'sparkle' | 'down' | 'lidded' | 'droopy' | 'tired' | 'closed' | 'happy';
export type Mouth = 'smile' | 'grin' | 'o' | 'wavy' | 'flat' | 'sleep' | 'thermometer';
export type Brows = 'none' | 'worried' | 'sad' | 'proud' | 'offended';

export interface Face {
  eyes: Eyes;
  mouth: Mouth;
  brows: Brows;
  cheeks: boolean;
}

const BLINKABLE: readonly Eyes[] = ['open', 'sparkle', 'down', 'lidded', 'droopy', 'tired'];

/** `skin` paints the eyelid; `mirror` flips the lid for the right eye so both droop outward. */
function eye(kind: Eyes, blinking: boolean, shadow: string, skin: string, mirror: boolean): string {
  if (blinking && BLINKABLE.includes(kind)) return path('M-9 1 Q0 3.5 9 1', line(INK, 3));
  switch (kind) {
    case 'open':
      return ellipse(0, 0, 8.5, 10.5, { fill: INK }) + circle(-3, -4, 3.2, { fill: WHITE }) + circle(3, 3.5, 1.4, { fill: WHITE });
    case 'sparkle':
      return (
        ellipse(0, 0, 9.5, 11.5, { fill: INK }) +
        circle(-3.2, -4.2, 4, { fill: WHITE }) +
        circle(3.4, 3.4, 2.1, { fill: WHITE }) +
        circle(-4, 4, 1, { fill: WHITE })
      );
    case 'down':
      return ellipse(0, 2.5, 8, 9, { fill: INK }) + circle(-2.8, -0.5, 2.6, { fill: WHITE });
    case 'lidded':
      return (
        path('M-9 -2 A9 10 0 0 0 9 -2 Z', { fill: INK }) +
        circle(-3, 2, 2.2, { fill: WHITE }) +
        path('M-10.5 -2.5 L10.5 -1.5', line(INK, 2.6))
      );
    case 'droopy':
      return (
        ellipse(0, 0, 8.5, 10.5, { fill: INK }) +
        circle(-3, 2.5, 2.4, { fill: WHITE }) +
        g(
          { transform: mirror ? 'scale(-1 1)' : undefined },
          path('M-12 -14 L12 -14 L12 -4 L-12 1 Z', { fill: skin }),
          path('M-10.5 0.5 L10.5 -3.5', line(INK, 2.6)),
        )
      );
    case 'tired':
      return (
        path('M-9 1.5 A9 8 0 0 0 9 1.5 Z', { fill: INK }) +
        path('M-10.5 1 L10.5 2', line(INK, 2.6)) +
        path('M-7 13 Q0 16 7 13', line(shadow, 2.4))
      );
    case 'closed':
      return path('M-9 -1 Q0 7 9 -1', line(INK, 3));
    case 'happy':
      return path('M-9 3 Q0 -8 9 3', line(INK, 3.2));
  }
}

/** Brow for the left eye; the right one is mirrored. The inner end is toward +x. */
function brow(kind: Brows): string {
  switch (kind) {
    case 'none':
      return '';
    case 'worried':
      return path('M-8 -15 L6 -20', line(INK, 2.6));
    case 'sad':
      return path('M-9 -13 L6 -19', line(INK, 2.6));
    case 'proud':
      return path('M-8 -17 Q0 -22 8 -18', line(INK, 2.6));
    case 'offended':
      return path('M-9 -21 L7 -15', line(INK, 2.8));
  }
}

function mouth(kind: Mouth, buckTooth: boolean): string {
  const tooth = (y: number) => rect(-3.5, y, 7, 6, { rx: 1.5, fill: WHITE, stroke: INK, 'stroke-width': 0.8 });
  switch (kind) {
    case 'smile':
      return path('M-10 -1 Q0 9 10 -1', line(INK, 3)) + (buckTooth ? tooth(3) : '');
    case 'grin':
      return (
        path('M-12 -2 Q0 17 12 -2 Z', { fill: INK }) +
        path('M-6.5 7 Q0 3.5 6.5 7 Q0 12 -6.5 7 Z', { fill: '#E98B8B' }) +
        (buckTooth ? tooth(-2) : '')
      );
    case 'o':
      return ellipse(0, 1, 4.2, 5.2, { fill: INK });
    case 'wavy':
      return path('M-9 1 Q-4.5 -3 0 1 T9 1', line(INK, 2.8)) + (buckTooth ? tooth(2) : '');
    case 'flat':
      return path('M-7 0 L7 0', line(INK, 2.8)) + (buckTooth ? tooth(1) : '');
    case 'sleep':
      return ellipse(0, 1, 3.2, 2.4, { fill: INK });
    case 'thermometer':
      return (
        path('M-5 0 L3 0', line(INK, 2.6)) +
        g(
          { transform: 'rotate(-16)' },
          rect(0, -2.6, 26, 5.2, { rx: 2.6, fill: WHITE, stroke: INK, 'stroke-width': 1 }),
          rect(4, -1, 12, 2, { rx: 1, fill: '#E0615A' }),
          circle(25, 0, 4, { fill: '#E0615A', stroke: INK, 'stroke-width': 1 }),
        )
      );
  }
}

export function drawFace(
  face: Face,
  geometry: Geometry,
  options: { eyeScale: number; blinking: boolean; skin: string; shadow: string; buckTooth: boolean },
): string {
  const { eyeY, eyeGap, mouthY } = geometry;
  const { eyeScale, blinking, skin, shadow, buckTooth } = options;
  const cheeks = face.cheeks
    ? g(
        { fill: CHEEK, opacity: 0.45 },
        ellipse(100 - eyeGap - 11, eyeY + 14, 7.5, 4.5),
        ellipse(100 + eyeGap + 11, eyeY + 14, 7.5, 4.5),
      )
    : '';
  // Both highlights stay on the same side; only the brows are mirrored.
  const oneEye = (x: number, mirror: boolean) =>
    g(
      { transform: `translate(${x} ${eyeY}) scale(${eyeScale})` },
      eye(face.eyes, blinking, shadow, skin, mirror),
      g({ transform: mirror ? 'scale(-1 1)' : undefined }, brow(face.brows)),
    );
  return (
    cheeks +
    oneEye(100 - eyeGap, false) +
    oneEye(100 + eyeGap, true) +
    g({ transform: `translate(100 ${mouthY})` }, mouth(face.mouth, buckTooth))
  );
}
