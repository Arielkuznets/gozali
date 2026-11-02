import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, spacing } from '@/theme/tokens';

type Props = { leaving: boolean; disabled?: boolean; onPress: () => void };

/** A plain way out at the top of a screen that stands between someone and the app. */
export function SignOutLink({ leaving, disabled = false, onPress }: Props) {
  const { t } = useTranslation();
  const inactive = disabled || leaving;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: leaving }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={8}
      style={styles.link}>
      {leaving && <ActivityIndicator color={colors.inkMuted} />}
      <AppText variant="caption">{t('me.signOut')}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: spacing.sm, minHeight: 44 },
});
