import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { CritterPlaceholder } from '@/components/CritterPlaceholder';
import { Screen } from '@/components/Screen';
import { signOut } from '@/features/auth/signIn';
import { colors, critterColors, spacing } from '@/theme/tokens';

export default function HomeScreen() {
  const { t } = useTranslation();

  const onSignOut = () => {
    signOut().catch(() => Alert.alert(t('errors.signInFailed')));
  };

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="heading">{t('home.title')}</AppText>
        <Pressable accessibilityRole="button" onPress={onSignOut} hitSlop={12}>
          <AppText variant="caption">{t('home.signOut')}</AppText>
        </Pressable>
      </View>

      <View style={styles.empty}>
        <CritterPlaceholder label={t('home.eggLabel')} size={120} color={critterColors.butter} />
        <AppText variant="heading" style={styles.center}>
          {t('home.emptyTitle')}
        </AppText>
        <AppText style={[styles.center, styles.muted]}>{t('home.emptyBody')}</AppText>
      </View>

      {/* Creating and joining packs arrive in phase 2. */}
      <View style={styles.actions}>
        <Button label={t('home.createPack')} disabled />
        <Button label={t('home.joinPack')} variant="secondary" disabled />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  center: { textAlign: 'center' },
  muted: { color: colors.inkMuted, maxWidth: 300 },
  actions: { gap: spacing.sm },
});
