import { useId } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { spacing } from '@/theme/tokens';

/**
 * A gold coin, drawn rather than an emoji so it looks the same on every phone. Ids inside the
 * drawing are unique per coin: on the web every screen shares one page.
 */
export function CoinIcon({ size = 16 }: { size?: number }) {
  const id = `coin${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <RadialGradient id={id} cx="38%" cy="32%" r="75%">
          <Stop offset="0" stopColor="#FFF4B8" />
          <Stop offset="0.45" stopColor="#F6C744" />
          <Stop offset="1" stopColor="#D49617" />
        </RadialGradient>
      </Defs>
      <Circle cx="12" cy="12" r="11" fill={`url(#${id})`} stroke="#B67C0E" strokeWidth="1" />
      <Circle cx="12" cy="12" r="7.6" fill="none" stroke="#C88A12" strokeWidth="1.1" opacity={0.75} />
      <Path d="M12 7.6l1.25 2.55 2.8.4-2.03 1.98.48 2.8L12 14.02l-2.5 1.31.48-2.8-2.03-1.98 2.8-.4z" fill="#FFF7CC" opacity={0.95} />
    </Svg>
  );
}

type Props = {
  /** What goes after the coin: a number, or a phrase like "34 coins". */
  text: string;
  variant?: 'body' | 'caption';
  style?: StyleProp<TextStyle>;
  size?: number;
  accessibilityLabel?: string;
};

/** A gold coin followed by an amount. */
export function Coins({ text, variant = 'caption', style, size, accessibilityLabel }: Props) {
  return (
    <View style={styles.row} accessible accessibilityLabel={accessibilityLabel ?? text}>
      <CoinIcon size={size ?? (variant === 'caption' ? 15 : 18)} />
      <AppText variant={variant} style={style}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
