import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

type Variant = 'title' | 'heading' | 'body' | 'caption';

/**
 * Text follows the phone's text size setting, up to a limit per variant: body text may double,
 * headings grow less, so the largest accessibility sizes stay readable without breaking layouts.
 */
const MAX_SCALE: Record<Variant, number> = { title: 1.3, heading: 1.6, body: 2, caption: 2 };

export function AppText({ variant = 'body', style, maxFontSizeMultiplier, ...props }: TextProps & { variant?: Variant }) {
  // A bigger font than the variant's line height was set for is clipped at the top and bottom
  // on iOS (the web shows it whole); such text gets a line height of its own.
  const own = StyleSheet.flatten(style) as TextStyle | undefined;
  const roomy =
    own?.fontSize !== undefined && own.lineHeight === undefined && own.fontSize > styles[variant].lineHeight * 0.8
      ? { lineHeight: Math.ceil(own.fontSize * 1.25) }
      : null;
  return (
    <Text
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? MAX_SCALE[variant]}
      style={[styles.base, styles[variant], style, roomy]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: colors.ink },
  title: { fontFamily: fonts.heading, fontSize: 40, lineHeight: 48 },
  heading: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 32 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
});
