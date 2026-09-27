import { addDays } from '@gozali/game-engine';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { signOut } from '@/features/auth/signIn';
import { pickAvatar, useAvatarUrls, useSetAvatar } from '@/features/profile/avatar';
import { useProfile } from '@/features/profile/useProfile';
import { useMyStats } from '@/features/social/api';
import { goBack } from '@/lib/navigation';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const BOARD_DAYS = 35;

/** Personal stats across all packs (spec section 9). */
export default function MeScreen() {
  const { t } = useTranslation();
  const profile = useProfile();
  const stats = useMyStats();
  const avatar = useAvatarUrls([profile.data?.avatar_path]);
  const setAvatar = useSetAvatar();
  const avatarUrl = profile.data?.avatar_path ? avatar.data?.get(profile.data.avatar_path) : undefined;

  const changePhoto = () => {
    const pickFrom = (source: 'camera' | 'library') => () =>
      void pickAvatar(source).then((uri) => uri && setAvatar.mutate(uri, { onError: () => Alert.alert(t('errors.saveFailed')) }));
    Alert.alert(t('me.photo'), undefined, [
      { text: t('me.takePhoto'), onPress: pickFrom('camera') },
      { text: t('me.choosePhoto'), onPress: pickFrom('library') },
      ...(profile.data?.avatar_path ? [{ text: t('me.removePhoto'), style: 'destructive' as const, onPress: () => setAvatar.mutate(null) }] : []),
      { text: t('social.cancel'), style: 'cancel' as const },
    ]);
  };

  const onSignOut = () => {
    signOut().catch(() => Alert.alert(t('errors.signInFailed')));
  };

  const byDay = new Map((stats.data?.days ?? []).map((entry) => [entry.day, entry.status]));
  const last = new Date().toISOString().slice(0, 10);
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
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('me.photo')} onPress={changePhoto} style={styles.avatarWrap}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <AppText style={styles.avatarInitial}>{(profile.data?.display_name?.trim()[0] ?? '?').toUpperCase()}</AppText>
              </View>
            )}
            <AppText variant="caption">{avatarUrl ? t('me.changePhoto') : t('me.addPhoto')}</AppText>
          </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  avatarWrap: { alignItems: 'center', gap: spacing.xs },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarEmpty: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fonts.heading, fontSize: 36, lineHeight: 44 },
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
