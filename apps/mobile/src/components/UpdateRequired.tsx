import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Critter } from '@/features/critter/Critter';
import { critterColors, spacing } from '@/theme/tokens';

/** Shown instead of the app when the server needs a newer version than the one installed. */
export function UpdateRequired({ storeUrl }: { storeUrl: string | null }) {
  const { t } = useTranslation();
  return (
    <Screen>
      {/* An iPad shows the app in a window that can be shorter than any phone. */}
      <ScrollView contentContainerStyle={styles.body}>
        <Critter
          art={{ species: 'hoot', color: critterColors.hoot, stage: 'kid', look: 'happy' }}
          size={160}
          label={t('update.critterLabel')}
        />
        <AppText variant="heading" style={styles.center}>
          {t('update.title')}
        </AppText>
        <AppText style={styles.center}>{t('update.body')}</AppText>
      </ScrollView>
      {storeUrl !== null && <Button label={t('update.button')} onPress={() => void Linking.openURL(storeUrl)} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.md },
  center: { textAlign: 'center' },
});
