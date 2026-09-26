import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

type Variant = 'title' | 'heading' | 'body' | 'caption';

export function AppText({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <Text {...props} style={[styles.base, styles[variant], style]} />;
}

const styles = StyleSheet.create({
  base: { color: colors.ink },
  title: { fontFamily: fonts.heading, fontSize: 40, lineHeight: 48 },
  heading: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 32 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkMuted },
});
