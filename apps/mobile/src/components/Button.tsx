import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
};

export function Button({ label, onPress, variant = 'primary', disabled = false, loading = false }: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, inactive && styles.inactive]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.ink} />
      ) : (
        <AppText style={[styles.label, variant === 'primary' && styles.primaryLabel]}>{label}</AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  pressed: { transform: [{ scale: 0.97 }] },
  inactive: { opacity: 0.5 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 17 },
  primaryLabel: { color: colors.onAccent },
});
