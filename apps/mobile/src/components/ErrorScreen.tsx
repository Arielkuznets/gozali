import { usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { reportError } from '@/lib/reportError';
import { colors, radii, spacing } from '@/theme/tokens';

/** As far as AppText lets body text grow. Try again is the only way out, so it scrolls into view. */
const MAX_SCALE = 2;

/**
 * Shown instead of a screen that failed to draw, so the app never goes blank. Plain components
 * only: it may show before the fonts or the data are ready.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  useEffect(() => reportError(error, pathname), [error, pathname]);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title} maxFontSizeMultiplier={MAX_SCALE}>
        {t('errors.crashTitle')}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={MAX_SCALE}>
        {t('errors.crashBody')}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.button}>
        <Text style={styles.buttonText} maxFontSizeMultiplier={MAX_SCALE}>
          {t('home.retry')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  title: { fontSize: 22, color: colors.ink, textAlign: 'center' },
  body: { fontSize: 16, color: colors.inkMuted, textAlign: 'center' },
  button: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.pill, backgroundColor: colors.accent },
  buttonText: { fontSize: 17, color: colors.onAccent },
});
