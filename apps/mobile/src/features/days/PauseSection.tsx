import { addDays } from '@gozali/game-engine';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ActionMenu, type Menu } from '@/components/ActionMenu';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PAUSE_LENGTHS, dayErrorKey, useDayStatus, useEndPause, useStartPause } from '@/features/days/api';
import { confirm, notify } from '@/lib/confirm';
import { formatDay } from '@/lib/dates';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/**
 * Pausing for a planned absence (spec section 5), in the pack settings: one calm card with a
 * Pause button that offers the lengths, rather than a row of numbers.
 */
export function PauseSection({ packId }: { packId: string }) {
  const { t } = useTranslation();
  const status = useDayStatus(packId);
  const startPause = useStartPause(packId);
  const endPause = useEndPause(packId);
  const [menu, setMenu] = useState<Menu | null>(null);
  const day = status.data;
  if (!day) return null;

  const onStart = (days: number) => {
    confirm({
      title: t('days.pauseConfirm', { count: days }),
      confirm: t('settings.confirm'),
      cancel: t('settings.cancel'),
      onConfirm: () => startPause.mutate(days, { onError: (error) => notify(t(dayErrorKey(error))) }),
    });
  };
  const chooseLength = () =>
    setMenu({
      title: t('days.pauseHowLong'),
      actions: PAUSE_LENGTHS.map((days) => ({ label: lengthLabel(days, t), onPress: () => onStart(days) })),
    });
  const onEnd = () => endPause.mutate(undefined, { onError: (error) => notify(t(dayErrorKey(error))) });

  const pause = day.pause;
  const upcoming = pause !== null && pause.startsOn > day.day;
  // A running pause can end after 3 paused days.
  const canEnd = pause !== null && (upcoming || addDays(pause.startsOn, 3) <= day.day);

  return (
    <View style={styles.card}>
      {pause ? (
        <>
          <AppText style={styles.title}>
            {upcoming
              ? t('days.pauseStarts', { date: formatDay(pause.startsOn), end: formatDay(pause.endsOn) })
              : t('days.pausedUntil', { date: formatDay(pause.endsOn) })}
          </AppText>
          {canEnd && (
            <Button
              label={upcoming ? t('days.cancelPause') : t('days.endPause')}
              variant="secondary"
              size="small"
              loading={endPause.isPending}
              onPress={onEnd}
            />
          )}
        </>
      ) : (
        <>
          <AppText style={styles.title}>{t('days.pauseTitle')}</AppText>
          <AppText variant="caption">
            {day.pauseAvailableFrom
              ? t('days.pauseAvailableFrom', { date: formatDay(day.pauseAvailableFrom) })
              : t('days.pauseBody')}
          </AppText>
          {!day.pauseAvailableFrom && (
            <Button label={t('days.pauseButton')} variant="secondary" size="small" loading={startPause.isPending} onPress={chooseLength} />
          )}
        </>
      )}
      <ActionMenu menu={menu} cancel={t('settings.cancel')} onClose={() => setMenu(null)} />
    </View>
  );
}

/** 3 days, 1 week, 2 weeks, 1 month, 2 months. */
function lengthLabel(days: number, t: ReturnType<typeof useTranslation>['t']): string {
  if (days % 30 === 0) return t('days.lengthMonths', { count: days / 30 });
  if (days % 7 === 0) return t('days.lengthWeeks', { count: days / 7 });
  return t('days.pauseDays', { count: days });
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontFamily: fonts.bodyMedium },
});
