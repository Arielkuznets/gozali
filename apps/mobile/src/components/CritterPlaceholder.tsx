import { StyleSheet, View } from 'react-native';

import type { CritterStatus, Species } from '@/features/packs/constants';
import { colors, critterColors } from '@/theme/tokens';

type Props = {
  label: string;
  size?: number;
  color?: string;
  species?: Species;
  status?: CritterStatus;
  /** The egg shows a crack once the second member joined (spec section 4). */
  cracking?: boolean;
};

// Width and height ratios and corner roundness per species, so the three read differently.
const SHAPES: Record<Species, { width: number; height: number; radius: number }> = {
  blob: { width: 1, height: 0.9, radius: 0.5 },
  spark: { width: 0.85, height: 1, radius: 0.32 },
  mossy: { width: 1.1, height: 0.8, radius: 0.4 },
};

/**
 * Temporary critter (spec section 10): a soft shape with eyes, used until the illustrated
 * critter exists. Screens treat it as one component, so swapping it later is a single change.
 */
export function CritterPlaceholder({
  label,
  size = 140,
  color = critterColors.peach,
  species = 'blob',
  status = 'active',
  cracking = false,
}: Props) {
  if (status === 'egg') {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={[
          styles.egg,
          { width: size * 0.75, height: size, borderRadius: size * 0.42, backgroundColor: color },
        ]}>
        {cracking && <View style={[styles.crack, { width: size * 0.3, top: size * 0.35 }]} />}
      </View>
    );
  }

  if (status === 'ran_away') {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={[styles.note, { width: size, height: size * 0.7 }]}
      />
    );
  }

  const shape = SHAPES[species];
  const eye = size * 0.12;
  const eyeStyle = { width: eye, height: eye * 1.3, borderRadius: eye };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        styles.body,
        {
          width: size * shape.width,
          height: size * shape.height,
          borderRadius: size * shape.radius,
          backgroundColor: color,
        },
      ]}>
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
  egg: { alignItems: 'center', opacity: 0.9 },
  crack: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: colors.ink, transform: [{ rotate: '-18deg' }] },
  note: { borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border },
});
