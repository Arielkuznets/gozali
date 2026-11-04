import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { hasConnection } from '@/features/feeds/queue';
import { colors, radii, spacing } from '@/theme/tokens';

/**
 * A quiet note while the phone is offline: feeds still work and go out later. Offline as the feed
 * queue goes by it, so a Wi-Fi with no way to the internet counts too.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const network = useNetInfo();
  const insets = useSafeAreaInsets();
  if (hasConnection(network)) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + spacing.xs }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <AppText variant="caption" style={styles.text}>
        {t('offline.banner')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
  },
  text: { color: colors.onDark },
});
