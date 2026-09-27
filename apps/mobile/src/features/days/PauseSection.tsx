import { addDays } from '@gozali/game-engine';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Choice } from '@/components/Choice';
import { PAUSE_LENGTHS, dayErrorKey, useDayStatus, useEndPause, useStartPause } from '@/features/days/api';
import { confirm, notify } from '@/lib/confirm';
import { formatDay } from '@/lib/dates';
import { colors, spacing } from '@/theme/tokens';

/** Pausing for a planned absence (spec section 5), in the pack settings. */
export function PauseSection({ packId }: { packId: string }) {
  const { t } = useTranslation();
  const status = useDayStatus(packId);
  const startPause = useStartPause(packId);
  const endPause = useEndPause(packId);
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
  const onEnd = () => endPause.mutate(undefined, { onError: (error) => notify(t(dayErrorKey(error))) });

  const pause = day.pause;
  const upcoming = pause !== null && pause.startsOn > day.day;
  // A running pause can end after 3 paused days.
  const canEnd = pause !== null && (upcoming || addDays(pause.startsOn, 3) <= day.day);

  return (
    <View style={styles.section}>
      <AppText variant="caption">{t('days.pauseTitle')}</AppText>
      {pause ? (
        <>
          <AppText>
            {upcoming
              ? t('days.pauseStarts', { date: formatDay(pause.startsOn), end: formatDay(pause.endsOn) })
              : t('days.pausedUntil', { date: formatDay(pause.endsOn) })}
          </AppText>
          {canEnd && (
            <Button
              label={upcoming ? t('days.cancelPause') : t('days.endPause')}
              variant="secondary"
              loading={endPause.isPending}
              onPress={onEnd}
            />
          )}
        </>
      ) : day.pauseAvailableFrom ? (
        <AppText style={styles.muted}>{t('days.pauseAvailableFrom', { date: formatDay(day.pauseAvailableFrom) })}</AppText>
      ) : (
        <>
          <AppText style={styles.muted}>{t('days.pauseBody')}</AppText>
          <View style={styles.row}>
            {PAUSE_LENGTHS.map((days) => (
              <Choice key={days} label={t('days.pauseDays', { count: days })} selected={false} onPress={() => onStart(days)}>
                <AppText variant="heading">{days}</AppText>
                <AppText variant="caption">{t('days.daysUnit')}</AppText>
              </Choice>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  muted: { color: colors.inkMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
