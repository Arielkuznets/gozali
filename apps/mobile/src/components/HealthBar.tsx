import { healthState, type HealthState } from '@gozali/game-engine';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radii } from '@/theme/tokens';

const FILL: Record<HealthState, string> = {
  thriving: '#7FB069',
  happy: '#A9C97F',
  hungry: '#E9C46A',
  weak: '#E8A15A',
  sick: '#D9735F',
  ran_away: colors.border,
};

/** Health as a bar; the text next to it carries the number, so color is not the only signal. */
export function HealthBar({ health, height = 10, style }: { health: number; height?: number; style?: StyleProp<ViewStyle> }) {
  const state = healthState({ status: 'active', health });
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }, style]} importantForAccessibility="no-hide-descendants">
      <View style={[styles.fill, { width: `${health}%`, backgroundColor: FILL[state], borderRadius: height / 2 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { alignSelf: 'stretch', backgroundColor: colors.border, overflow: 'hidden', borderRadius: radii.pill },
  fill: { height: '100%' },
});
