import type { ErrorBoundaryProps } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '@/theme/tokens';

/**
 * Shown instead of a screen that failed to draw, so the app never goes blank. Plain components
 * only: it may show before the fonts or the data are ready.
 */
export function ErrorScreen({ retry }: ErrorBoundaryProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('errors.crashTitle')}</Text>
      <Text style={styles.body}>{t('errors.crashBody')}</Text>
      <Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.button}>
        <Text style={styles.buttonText}>{t('home.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  title: { fontSize: 22, color: colors.ink, textAlign: 'center' },
  body: { fontSize: 16, color: colors.inkMuted, textAlign: 'center' },
  button: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radii.pill, backgroundColor: colors.accent },
  buttonText: { fontSize: 17, color: colors.onAccent },
});
