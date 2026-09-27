import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { dayErrorKey, useCancelDayPass, useDayPass, useDayStatus } from '@/features/days/api';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/** A rest day or the month's joker, for today only (spec section 5). */
export default function NotTodayScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const status = useDayStatus(id);
  const dayPass = useDayPass(id);
  const cancelPass = useCancelDayPass(id);

  const choose = (pass: 'rest' | 'joker') =>
    dayPass.mutate(pass, {
      onSuccess: () => router.back(),
      onError: (error) => Alert.alert(t(dayErrorKey(error))),
    });

  if (!status.data) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }
  const day = status.data;

  return (
    <Screen>
      <View style={styles.body}>
        <AppText variant="heading">{t('days.title')}</AppText>
        <AppText style={styles.muted}>{t('days.body')}</AppText>

        {day.passToday ? (
          <View style={styles.card}>
            <AppText style={styles.cardTitle}>
              {day.passToday === 'rest' ? t('pack.restingToday') : t('pack.jokerToday')}
            </AppText>
            <Button
              label={t('pack.undo')}
              variant="secondary"
              size="small"
              loading={cancelPass.isPending}
              onPress={() => cancelPass.mutate(undefined, { onError: (error) => Alert.alert(t(dayErrorKey(error))) })}
            />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardText}>
                <AppText style={styles.cardTitle}>{t('days.rest')}</AppText>
                <AppText variant="caption">
                  {day.restDaysLeft > 0 ? t('days.restLeft', { count: day.restDaysLeft }) : t('days.restNone')}
                </AppText>
              </View>
              <Button
                label={t('days.use')}
                size="small"
                disabled={day.restDaysLeft === 0 || dayPass.isPending}
                onPress={() => choose('rest')}
              />
            </View>
            <View style={styles.card}>
              <View style={styles.cardText}>
                <AppText style={styles.cardTitle}>{t('days.joker')}</AppText>
                <AppText variant="caption">{day.jokerAvailable ? t('days.jokerAvailable') : t('days.jokerUsed')}</AppText>
              </View>
              <Button
                label={t('days.use')}
                size="small"
                disabled={!day.jokerAvailable || dayPass.isPending}
                onPress={() => choose('joker')}
              />
            </View>
          </>
        )}
        <AppText variant="caption">{t('days.feedCancels')}</AppText>
      </View>

      <View style={styles.actions}>
        <Button label={t('days.away')} variant="secondary" onPress={() => router.replace(`/pack/${id}/settings`)} />
        <Button label={t('days.close')} variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: spacing.md, paddingTop: spacing.xl },
  muted: { color: colors.inkMuted },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodyMedium, flex: 1 },
  actions: { gap: spacing.sm },
});
