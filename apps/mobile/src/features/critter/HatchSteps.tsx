import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { colors, fonts, spacing } from '@/theme/tokens';

type Props = {
  friendJoined: boolean;
  fedToday: number;
  /** Nothing the others do today can stop the hatch (hatchesTonight). */
  certain: boolean;
};

/**
 * How the egg hatches (spec section 4), as three steps that tick off: a friend joins, two members
 * feed on the same day, and the egg hatches when that day ends.
 */
export function HatchSteps({ friendJoined, fedToday, certain }: Props) {
  const { t } = useTranslation();
  const bothFed = friendJoined && fedToday >= 2;
  const ending = bothFed ? (certain ? t('pack.hatch.tonight') : t('pack.hatch.tonightIf')) : t('pack.hatch.dayEnds');
  const steps = [
    { done: friendJoined, text: t('pack.hatch.join') },
    { done: bothFed, text: bothFed ? t('pack.hatch.fedDone') : t('pack.hatch.feed', { count: Math.min(fedToday, 2) }) },
    { done: false, text: ending },
  ];
  return (
    <View style={styles.hatch} accessible accessibilityLabel={steps.map((step) => step.text).join('. ')}>
      <AppText style={styles.hatchTitle}>{t('pack.hatch.title')}</AppText>
      {steps.map((step) => (
        <View key={step.text} style={styles.hatchStep}>
          <AppText style={[styles.hatchMark, step.done && styles.hatchMarkDone]}>{step.done ? '✓' : '○'}</AppText>
          <AppText style={[styles.hatchText, step.done && styles.hatchTextDone]}>{step.text}</AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hatch: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hatchTitle: { fontFamily: fonts.bodyMedium },
  hatchStep: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  hatchMark: { width: 20, textAlign: 'center', color: colors.inkMuted },
  hatchMarkDone: { color: colors.accentText, fontFamily: fonts.bodyBold },
  hatchText: { flex: 1, color: colors.inkMuted },
  hatchTextDone: { color: colors.ink },
});
