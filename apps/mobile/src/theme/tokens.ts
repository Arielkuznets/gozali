// Design tokens from spec section 10: warm pastels on cream, one accent, soft shapes.

import { CREATURE_ACCENTS, CREATURE_COLORS } from '@gozali/critter-art';

export const colors = {
  background: '#FBF6EE',
  surface: '#FFFDF9',
  ink: '#3B2F2A',
  inkMuted: '#7A6A60',
  border: '#EADFD2',
  accent: '#E8795A',
  // The accent as text (links) is darker: the fill color reads at 2.7:1 on the background,
  // this one at 4.8:1, above the 4.5:1 WCAG asks of small text.
  accentText: '#B34E37',
  onAccent: '#FFFFFF',
  // 5:1 on the background, for red text like Delete account.
  danger: '#B04A3F',
} as const;

/** Each creature's own color; the critter drawing owns them. */
export const critterColors = CREATURE_COLORS;
/** A stronger shade of each creature for the circles and boards around it. */
export const critterAccents = CREATURE_ACCENTS;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radii = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

/** One rounded font for headings and one clean font for text; both cover Hebrew for the launch. */
export const fonts = {
  heading: 'VarelaRound_400Regular',
  body: 'Rubik_400Regular',
  bodyMedium: 'Rubik_500Medium',
  bodyBold: 'Rubik_700Bold',
} as const;
