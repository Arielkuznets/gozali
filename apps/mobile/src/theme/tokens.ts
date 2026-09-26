// Design tokens from spec section 10: warm pastels on cream, one accent, soft shapes.

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

/** The six critter colors a pack can pick from. */
export const critterColors = {
  peach: '#F6C9A8',
  butter: '#F7E3A1',
  sage: '#BFD8B8',
  sky: '#BCD9E8',
  blush: '#F2B8C6',
  sand: '#E6D3B8',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radii = { sm: 10, md: 16, lg: 24, pill: 999 } as const;

/** One rounded font for headings and one clean font for text; both cover Hebrew for the launch. */
export const fonts = {
  heading: 'VarelaRound_400Regular',
  body: 'Rubik_400Regular',
  bodyMedium: 'Rubik_500Medium',
  bodyBold: 'Rubik_700Bold',
} as const;
