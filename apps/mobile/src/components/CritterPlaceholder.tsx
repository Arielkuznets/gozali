import { StyleSheet, View } from 'react-native';

import { colors, critterColors } from '@/theme/tokens';

type Props = { label: string; size?: number; color?: string };

/**
 * Temporary critter (spec section 10): a soft shape with eyes, used until the illustrated
 * critter exists. Screens treat it as one component, so swapping it later is a single change.
 */
export function CritterPlaceholder({ label, size = 140, color = critterColors.peach }: Props) {
  const eye = size * 0.12;
  const eyeStyle = { width: eye, height: eye * 1.3, borderRadius: eye };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.body, { width: size, height: size * 0.9, borderRadius: size / 2, backgroundColor: color }]}>
      <View style={[styles.eyes, { gap: size * 0.18, marginTop: size * 0.28 }]}>
        <View style={[styles.eye, eyeStyle]} />
        <View style={[styles.eye, eyeStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center' },
  eyes: { flexDirection: 'row' },
  eye: { backgroundColor: colors.ink },
});
