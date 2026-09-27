import type { CritterArt } from '@gozali/critter-art';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Critter } from '@/features/critter/Critter';
import { colors, critterColors, spacing } from '@/theme/tokens';

/** The three rules and the reward, told by the critters (spec section 9). */
const CARDS: readonly { key: 'photo' | 'together' | 'neverDies' | 'dressUp'; art: CritterArt }[] = [
  { key: 'photo', art: { species: 'mochi', color: critterColors.mochi, stage: 'kid', look: 'thriving' } },
  {
    key: 'together',
    art: { species: 'axo', color: critterColors.axo, stage: 'kid', look: 'happy', mood: 1 },
  },
  { key: 'neverDies', art: { species: 'hoot', color: critterColors.hoot, stage: 'kid', look: 'happy', marks: ['bandage'] } },
  {
    key: 'dressUp',
    art: { species: 'kit', color: critterColors.kit, stage: 'kid', look: 'thriving', outfit: { head: 'crown', neck: 'bow_tie' } },
  },
];

/** The rules one card at a time. `onDone` runs on skip and after the last card. */
export function RulesCards({ onDone, doneLabel }: { onDone: () => void; doneLabel: string }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const card = CARDS[index] ?? CARDS[0]!;
  const last = index === CARDS.length - 1;

  return (
    <>
      <View style={styles.header}>
        {!last && (
          <Pressable accessibilityRole="button" onPress={onDone} hitSlop={12}>
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
      <Button label={last ? doneLabel : t('onboarding.next')} onPress={() => (last ? onDone() : setIndex(index + 1))} />
    </>
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
