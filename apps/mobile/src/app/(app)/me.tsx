import { addDays } from '@gozali/game-engine';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { signOut } from '@/features/auth/signIn';
import { useProfile } from '@/features/profile/useProfile';
import { useMyStats } from '@/features/social/api';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const BOARD_DAYS = 35;

/** Personal stats across all packs (spec section 9). */
export default function MeScreen() {
  const { t } = useTranslation();
  const profile = useProfile();
  const stats = useMyStats();

  const onSignOut = () => {
    signOut().catch(() => Alert.alert(t('errors.signInFailed')));
  };

  const byDay = new Map((stats.data?.days ?? []).map((entry) => [entry.day, entry.status]));
  const last = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: BOARD_DAYS }, (_, index) => addDays(last, index - BOARD_DAYS + 1));

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <AppText variant="caption">{t('me.back')}</AppText>
        </Pressable>
        <AppText variant="heading">{profile.data?.display_name ?? t('me.title')}</AppText>
        <View style={styles.headerSpacer} />
      </View>

      {!stats.data ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
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
                  style={[
                    styles.cell,
                    status === 'fed' && styles.fed,
                    status === 'rest' && styles.rest,
                    status === 'missed' && styles.missed,
                  ]}>
                  <AppText style={styles.cellText}>{Number(day.slice(8))}</AppText>
                </View>
              );
            })}
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendCell, styles.fed]} />
            <AppText variant="caption">{t('profile.legendFed')}</AppText>
            <View style={[styles.legendCell, styles.rest]} />
            <AppText variant="caption">{t('profile.legendRest')}</AppText>
            <View style={[styles.legendCell, styles.missed]} />
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
  headerSpacer: { width: 32 },
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
  fed: { backgroundColor: '#BFD8B8' },
  rest: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inkMuted },
  missed: { backgroundColor: '#F4CFC9' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  legendCell: { width: 12, height: 12, borderRadius: 3 },
});
