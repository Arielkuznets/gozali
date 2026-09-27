import { CHEEK, INK, WHITE } from './palette.ts';
import type { Geometry } from './geometry.ts';
import { circle, ellipse, g, line, path, rect } from './svg.ts';

export type Eyes = 'open' | 'sparkle' | 'down' | 'lidded' | 'droopy' | 'tired' | 'closed' | 'happy' | 'squeezed';
export type Mouth = 'smile' | 'grin' | 'o' | 'wavy' | 'flat' | 'sleep' | 'thermometer' | 'yawn';
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
    case 'squeezed':
      // A ">" for the left eye and a "<" for the right, pressed shut mid-yawn.
      return g({ transform: mirror ? 'scale(-1 1)' : undefined }, path('M-8 -5 L4 0.5 L-8 6', line(INK, 3)));
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

function mouth(kind: Mouth): string {
  switch (kind) {
    case 'smile':
      return path('M-10 -1 Q0 9 10 -1', line(INK, 3));
    case 'grin':
      return path('M-12 -2 Q0 17 12 -2 Z', { fill: INK }) + path('M-6.5 7 Q0 3.5 6.5 7 Q0 12 -6.5 7 Z', { fill: '#E98B8B' });
    case 'o':
      return ellipse(0, 1, 4.2, 5.2, { fill: INK });
    case 'wavy':
      return path('M-9 1 Q-4.5 -3 0 1 T9 1', line(INK, 2.8));
    case 'flat':
      return path('M-7 0 L7 0', line(INK, 2.8));
    case 'sleep':
      return ellipse(0, 1, 3.2, 2.4, { fill: INK });
    case 'yawn':
      return ellipse(0, 4, 7.5, 10.5, { fill: INK }) + ellipse(0, 10, 4.8, 3.6, { fill: '#E98B8B' });
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
  options: {
    eyeScale: number;
    blinking: boolean;
    skin: string;
    shadow: string;
    gaze?: { x: number; y: number };
  },
): string {
  const { eyeY, eyeGap, mouthY } = geometry;
  const { eyeScale, blinking, skin, shadow, gaze } = options;
  // The eyes shift a little toward the gaze; the brows stay put.
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const look = gaze ? { x: clamp(gaze.x) * 2.6, y: clamp(gaze.y) * 2.2 } : { x: 0, y: 0 };
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
      g({ transform: look.x || look.y ? `translate(${look.x} ${look.y})` : undefined }, eye(face.eyes, blinking, shadow, skin, mirror)),
      g({ transform: mirror ? 'scale(-1 1)' : undefined }, brow(face.brows)),
    );
  return (
    cheeks +
    oneEye(100 - eyeGap, false) +
    oneEye(100 + eyeGap, true) +
    g({ transform: `translate(100 ${mouthY})` }, mouth(face.mouth))
  );
}
