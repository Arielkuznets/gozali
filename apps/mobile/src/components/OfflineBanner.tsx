import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { colors, radii, spacing } from '@/theme/tokens';

/** A quiet note while the phone is offline: feeds still work and go out later. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const { isConnected } = useNetInfo();
  const insets = useSafeAreaInsets();
  if (isConnected !== false) return null;
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
  text: { color: colors.onAccent },
});
