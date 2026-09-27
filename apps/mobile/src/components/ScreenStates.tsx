import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { colors, spacing } from '@/theme/tokens';

export function LoadingScreen() {
  return (
    <Screen>
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    </Screen>
  );
}

/**
 * For a pack the member can't see (any more): removed, left on another phone, or a link to a
 * pack they were never in.
 */
export function PackMissingScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <View style={styles.center}>
        <AppText variant="heading" style={styles.text}>
          {t('pack.missingTitle')}
        </AppText>
        <AppText style={[styles.text, styles.muted]}>{t('pack.missingBody')}</AppText>
      </View>
      <Button label={t('pack.backHome')} onPress={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  text: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
});
