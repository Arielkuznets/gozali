import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export function TextField({ label, style, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={styles.field}>
      {label !== undefined && <AppText variant="caption">{label}</AppText>}
      <TextInput placeholderTextColor={colors.inkMuted} {...props} style={[styles.input, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
});
