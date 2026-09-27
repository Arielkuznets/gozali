import { addDays, packDayOf } from '@gozali/game-engine';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { LoadFailed } from '@/components/ScreenStates';
import { signOut } from '@/features/auth/signIn';
import { AvatarButton } from '@/features/profile/AvatarButton';
import { useProfile } from '@/features/profile/useProfile';
import { useMyStats } from '@/features/social/api';
import { notify } from '@/lib/confirm';
import { deviceTimeZone, formatDay } from '@/lib/dates';
import { goBack } from '@/lib/navigation';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const BOARD_DAYS = 35;
const STATUS_LABELS = { fed: 'profile.legendFed', rest: 'profile.legendRest', missed: 'profile.legendMissed' } as const;

/** Personal stats across all packs (spec section 9). */
export default function MeScreen() {
  const { t } = useTranslation();
  const profile = useProfile();
  const stats = useMyStats();

  const onSignOut = () => {
    signOut().catch(() => notify(t('errors.signInFailed')));
  };

  const byDay = new Map((stats.data?.days ?? []).map((entry) => [entry.day, entry.status]));
  // The pack day on this phone: until 03:00 it is still yesterday's.
  const last = packDayOf(new Date(), deviceTimeZone());
  const days = Array.from({ length: BOARD_DAYS }, (_, index) => addDays(last, index - BOARD_DAYS + 1));

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack('/')} hitSlop={12}>
          <AppText variant="caption">{t('me.back')}</AppText>
        </Pressable>
        <AppText variant="heading">{profile.data?.display_name ?? t('me.title')}</AppText>
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} hitSlop={12}>
          <AppText variant="caption">{t('settings.app.open')}</AppText>
        </Pressable>
      </View>

      {!stats.data ? (
        stats.isError ? (
          <LoadFailed onRetry={() => void stats.refetch()} />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <AvatarButton name={profile.data?.display_name} />
          <View style={styles.stats}>
            {(
              [
                ['totalFeeds', stats.data.totalFeeds],
                ['currentStreak', stats.data.currentStreak],
                ['bestStreak', stats.data.bestStreak],
              ] as const
            ).map(([key, value]) => (
              <View key={key} style={styles.stat}>
                <AppText style={styles.statValue}>{value}</AppText>
                <AppText variant="caption" style={styles.centerText}>
                  {t(`me.${key}`)}
                </AppText>
              </View>
            ))}
          </View>
          <AppText variant="caption">{t('me.streakHint')}</AppText>

          <AppText style={styles.sectionTitle}>{t('me.board')}</AppText>
          <View style={styles.grid}>
            {days.map((day) => {
              const status = byDay.get(day);
              return (
                <View
                  key={day}
                  accessible
                  accessibilityLabel={status ? t('me.boardDay', { day: formatDay(day), status: t(STATUS_LABELS[status]) }) : formatDay(day)}
                  style={[
                    styles.cell,
                    status === 'fed' && styles.fed,
                    status === 'rest' && styles.rest,
                    status === 'missed' && styles.missed,
                  ]}>
                  <AppText style={[styles.cellText, status === 'fed' && styles.fedText, status === 'missed' && styles.missedText]}>
                    {Number(day.slice(8))}
                  </AppText>
                </View>
              );
            })}
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendCell, styles.fed]} />
            <AppText variant="caption">{t('profile.legendFed')}</AppText>
            <View style={[styles.legendCell, styles.rest]} />
            <AppText variant="caption">{t('profile.legendRest')}</AppText>
            <View style={[styles.legendCell, styles.missed]}>
              <View style={styles.legendMissedMark} />
            </View>
            <AppText variant="caption">{t('profile.legendMissed')}</AppText>
          </View>
        </ScrollView>
      )}

      <Button label={t('me.signOut')} variant="secondary" onPress={onSignOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  centerText: { textAlign: 'center' },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statValue: { fontFamily: fonts.heading, fontSize: 32, lineHeight: 40 },
  sectionTitle: { fontFamily: fonts.bodyMedium },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: {
    width: '13%',
    aspectRatio: 1,
    borderRadius: radii.sm,
    backgroundColor: '#F1EAE0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontSize: 11, color: colors.inkMuted },
  fedText: { fontFamily: fonts.bodyBold, color: colors.ink },
  missedText: { color: colors.danger, textDecorationLine: 'line-through' },
  fed: { backgroundColor: '#BFD8B8' },
  rest: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inkMuted },
  missed: { backgroundColor: '#F4CFC9' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  legendCell: { width: 12, height: 12, borderRadius: 3, overflow: 'hidden' },
  legendMissedMark: { position: 'absolute', left: 2, right: 2, top: 5, height: 1.5, backgroundColor: colors.danger },
});
