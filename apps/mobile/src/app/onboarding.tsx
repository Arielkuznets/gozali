import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CritterArt } from '@gozali/critter-art';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { Critter } from '@/features/critter/Critter';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';
import { colors, critterColors, spacing } from '@/theme/tokens';

/** The three rules, told by the critters (spec section 9). Shown once, and it can be skipped. */
const CARDS: readonly { key: 'photo' | 'together' | 'neverDies'; art: CritterArt }[] = [
  { key: 'photo', art: { species: 'blob', color: critterColors.peach, stage: 'kid', look: 'thriving' } },
  {
    key: 'together',
    art: { species: 'spark', color: critterColors.blush, stage: 'kid', look: 'happy', mood: 1 },
  },
  { key: 'neverDies', art: { species: 'mossy', color: critterColors.sage, stage: 'kid', look: 'happy', marks: ['bandage'] } },
];

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const card = CARDS[index] ?? CARDS[0]!;
  const last = index === CARDS.length - 1;

  const finish = async () => {
    await AsyncStorage.setItem(ONBOARDED_KEY, '1');
    router.replace('/welcome');
  };

  return (
    <Screen>
      <View style={styles.header}>
        {!last && (
          <Pressable accessibilityRole="button" onPress={() => void finish()} hitSlop={12}>
            <AppText variant="caption">{t('onboarding.skip')}</AppText>
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        <Critter key={card.key} art={card.art} size={200} label={t(`onboarding.${card.key}.title`)} />
        <AppText variant="heading" style={styles.centerText}>
          {t(`onboarding.${card.key}.title`)}
        </AppText>
        <AppText style={[styles.centerText, styles.muted]}>{t(`onboarding.${card.key}.body`)}</AppText>
        <View style={styles.dots} accessibilityLabel={t('onboarding.progress', { step: index + 1, count: CARDS.length })}>
          {CARDS.map((item, dot) => (
            <View key={item.key} style={[styles.dot, dot === index && styles.dotOn]} />
          ))}
        </View>
      </View>
      <Button
        label={last ? t('onboarding.start') : t('onboarding.next')}
        onPress={() => (last ? void finish() : setIndex(index + 1))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'flex-end', minHeight: 48, paddingVertical: spacing.md },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted, maxWidth: 320 },
  dots: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent, width: 20 },
});
