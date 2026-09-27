// Design tokens from spec section 10: warm pastels on cream, one accent, soft shapes.

import { CREATURE_COLORS } from '@gozali/critter-art';

export const colors = {
  background: '#FBF6EE',
  surface: '#FFFDF9',
  ink: '#3B2F2A',
  inkMuted: '#7A6A60',
  border: '#EADFD2',
  accent: '#E8795A',
  onAccent: '#FFFFFF',
  danger: '#C95D51',
} as const;

/** Each creature's own color; the critter drawing owns them. */
export const critterColors = CREATURE_COLORS;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radii = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

/** One rounded font for headings and one clean font for text; both cover Hebrew for the launch. */
export const fonts = {
  heading: 'VarelaRound_400Regular',
  body: 'Rubik_400Regular',
  bodyMedium: 'Rubik_500Medium',
  bodyBold: 'Rubik_700Bold',
} as const;
