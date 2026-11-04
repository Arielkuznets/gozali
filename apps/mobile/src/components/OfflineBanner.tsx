import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { hasConnection } from '@/features/feeds/queue';
import { colors, radii, spacing } from '@/theme/tokens';

/**
 * A quiet note while the phone is offline: feeds still work and go out later. Offline as the feed
 * queue goes by it, so a Wi-Fi with no way to the internet counts too. It takes its own room above
 * the screens, so their top buttons stay in sight.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const network = useNetInfo();
  const insets = useSafeAreaInsets();
  if (hasConnection(network)) return null;
  return (
    // Each screen below pads its top by the status bar's inset too, so the banner hands that much
    // back and the screens start where it ends, their padding under it.
    <View
      style={[styles.strip, { paddingTop: insets.top + spacing.xs, marginBottom: -insets.top }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite">
      <View style={styles.pill}>
        <AppText variant="caption" maxFontSizeMultiplier={1.3} style={styles.text}>
          {t('offline.banner')}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    zIndex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
  },
  text: { color: colors.onDark, textAlign: 'center' },
});
