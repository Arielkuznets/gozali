import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  label: string;
  /** A symbol before the label, like ‹ for back. */
  icon?: string;
  onPress: () => void;
};

/** A button at the top of a screen (Back, Invite, Settings, Me): a pill, easy to see and to hit. */
export function HeaderButton({ label, icon, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      {icon !== undefined && <AppText style={styles.icon}>{icon}</AppText>}
      <AppText style={styles.label}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  pressed: { transform: [{ scale: 0.96 }], backgroundColor: colors.background },
  icon: { fontSize: 17, lineHeight: 20, color: colors.ink },
  label: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 20 },
});
