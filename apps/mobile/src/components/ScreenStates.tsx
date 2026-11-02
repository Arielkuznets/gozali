import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HeaderButton } from '@/components/HeaderButton';
import { Screen } from '@/components/Screen';
import { packsKey } from '@/features/packs/api';
import { goBack } from '@/lib/navigation';
import { colors, spacing } from '@/theme/tokens';

/**
 * A screen of a pack that can't load has none of its own buttons yet, and the swipe and the
 * hardware key say nothing to someone looking at a spinner.
 */
function BackHeader() {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <HeaderButton icon="‹" label={t('pack.back')} onPress={() => goBack('/')} />
    </View>
  );
}

export function LoadingScreen({ back = false }: { back?: boolean }) {
  return (
    <Screen>
      {back && <BackHeader />}
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    </Screen>
  );
}

/** Something didn't load, most likely the connection; the user can try again. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.center}>
      <AppText style={[styles.text, styles.muted]}>{t('errors.loadFailed')}</AppText>
      <Button label={t('home.retry')} variant="secondary" size="small" onPress={onRetry} />
    </View>
  );
}

/** For a screen of a pack that wouldn't load. */
export function LoadFailedScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <Screen>
      <BackHeader />
      <LoadFailed onRetry={onRetry} />
    </Screen>
  );
}

/**
 * For a pack the member can't see (any more): removed, left on another phone, or a link to a
 * pack they were never in.
 */
export function PackMissingScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // The home screen under this one reads nothing as it comes back, and may still list this pack.
  const backHome = () => {
    void queryClient.invalidateQueries({ queryKey: packsKey });
    router.dismissTo('/');
  };

  return (
    <Screen>
      <View style={styles.center}>
        <AppText variant="heading" style={styles.text}>
          {t('pack.missingTitle')}
        </AppText>
        <AppText style={[styles.text, styles.muted]}>{t('pack.missingBody')}</AppText>
      </View>
      <Button label={t('pack.backHome')} onPress={backHome} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', paddingVertical: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  text: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
});
