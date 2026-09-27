import { dayEnd, packDayOf } from '@gozali/game-engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HealthBar } from '@/components/HealthBar';
import { MemberCircles } from '@/components/MemberCircles';
import { Screen } from '@/components/Screen';
import { Critter } from '@/features/critter/Critter';
import { critterArt, stageProgress } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { currentMembers, usePack, type Pack, type PackCritter } from '@/features/packs/api';
import { PACK_SIZE_MAX, categoryInfo } from '@/features/packs/constants';
import { usePackRealtime } from '@/features/packs/realtime';
import { useNow } from '@/lib/useNow';
import { colors, fonts, spacing } from '@/theme/tokens';

export default function PackScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending } = usePack(id);
  usePackRealtime(id);

  if (isPending || !pack) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  const members = currentMembers(pack);
  const habit = pack.custom_habit ?? t(`packs.categories.${pack.category}`);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <AppText variant="caption">{t('pack.back')}</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push(`/pack/${id}/settings`)} hitSlop={12}>
          <AppText variant="caption">{t('pack.settings')}</AppText>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <AppText variant="heading" style={styles.centerText}>
          {pack.name}
        </AppText>
        <AppText variant="caption" style={styles.centerText}>
          {categoryInfo(pack.category).emoji} {habit} · {t('packs.restDays', { count: pack.rest_days_per_week })}
        </AppText>

        {pack.critters && <CritterPanel pack={pack} critter={pack.critters} memberCount={members.length} />}

        <AppText variant="caption">{t('pack.members')}</AppText>
        <MemberCircles
          members={members.map((member) => ({
            id: member.user_id,
            name: member.profiles?.display_name ?? null,
            asleep: member.status === 'sleeping',
          }))}
        />
      </ScrollView>

      {members.length < PACK_SIZE_MAX && (
        <Button label={t('pack.invite')} variant="secondary" onPress={() => router.push(`/pack/${id}/invite`)} />
      )}
    </Screen>
  );
}

function CritterPanel({ pack, critter, memberCount }: { pack: Pack; critter: PackCritter; memberCount: number }) {
  const { t } = useTranslation();
  const now = useNow(30_000);
  const art = critterArt(critter, { category: pack.category, now, cracking: memberCount >= 2 });
  const text = useCritterText(critter, art);
  const progress = stageProgress(critter.stage);
  // Days close only once a second member joined.
  const daysRun = memberCount >= 2;

  return (
    <View style={styles.critter}>
      <Critter art={art} size={220} label={text.label} lines={text.lines} petHint={t('critter.petHint')} />
      <AppText variant="heading">{text.name}</AppText>

      {art.look === 'egg' && (
        <AppText style={[styles.centerText, styles.muted]}>
          {daysRun ? t('pack.eggCracking') : t('pack.eggWaiting')}
        </AppText>
      )}

      {art.look === 'ran_away' && (
        <>
          <AppText style={styles.note}>{t('critter.ranAwayNote')}</AppText>
          <AppText style={[styles.centerText, styles.muted]}>{t('critter.ranAwayBody', { name: text.name })}</AppText>
          <AppText variant="caption">{t('critter.streak', { count: critter.streak })}</AppText>
        </>
      )}

      {art.look !== 'egg' && art.look !== 'ran_away' && (
        <View style={styles.stats}>
          <AppText variant="caption" style={styles.centerText}>
            {t(`critter.states.${art.look}`)} · {t(`critter.stages.${critter.stage}`)}
          </AppText>
          <HealthBar health={critter.health} />
          <View style={styles.statsRow}>
            <AppText variant="caption">{t('critter.health', { health: critter.health })}</AppText>
            <AppText variant="caption">{t('critter.streak', { count: critter.streak })}</AppText>
          </View>
          <AppText variant="caption" style={styles.centerText}>
            {progress
              ? t('critter.xp', { xp: critter.xp, to: progress.to, stage: t(`critter.stages.${progress.next}`) })
              : t('critter.xpMax', { xp: critter.xp })}
          </AppText>
        </View>
      )}

      {daysRun && <DayCountdown timeZone={pack.timezone} now={now} />}
    </View>
  );
}

function DayCountdown({ timeZone, now }: { timeZone: string; now: Date }) {
  const { t } = useTranslation();
  const left = Math.max(0, dayEnd(packDayOf(now, timeZone), timeZone).getTime() - now.getTime());
  const hours = Math.floor(left / 3_600_000);
  const minutes = Math.floor((left % 3_600_000) / 60_000);
  const time = hours > 0 ? t('critter.hoursMinutes', { hours, minutes }) : t('critter.minutes', { minutes });
  return <AppText variant="caption">{t('critter.dayEndsIn', { time })}</AppText>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
  critter: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.md },
  note: { fontFamily: fonts.heading, fontSize: 18 },
  stats: { alignSelf: 'stretch', gap: spacing.xs, paddingHorizontal: spacing.lg },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
