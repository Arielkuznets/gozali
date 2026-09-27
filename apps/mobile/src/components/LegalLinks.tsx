import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, spacing } from '@/theme/tokens';

export const TERMS_URL = 'https://gozali.app/terms';
export const PRIVACY_URL = 'https://gozali.app/privacy';

/** The terms and the privacy policy, one tap away wherever someone agrees to them. */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)} hitSlop={8}>
        <AppText variant="caption" style={styles.link}>
          {t('settings.app.terms')}
        </AppText>
      </Pressable>
      <AppText variant="caption">·</AppText>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)} hitSlop={8}>
        <AppText variant="caption" style={styles.link}>
          {t('settings.app.privacy')}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  link: { color: colors.accent },
});
