import { dayEnd, packDayOf } from '@gozali/game-engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HealthBar } from '@/components/HealthBar';
import { MemberCircles, type MemberState } from '@/components/MemberCircles';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { Critter } from '@/features/critter/Critter';
import { critterArt, stageProgress } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { FeedList } from '@/features/feeds/FeedList';
import { fedToday, useCountedFeeds, usePackFeed, usePendingFeeds } from '@/features/feeds/api';
import { currentMembers, usePack, type Pack, type PackCritter, type PackMember } from '@/features/packs/api';
import { PACK_SIZE_MAX, categoryInfo } from '@/features/packs/constants';
import { usePackRealtime } from '@/features/packs/realtime';
import { useNow } from '@/lib/useNow';
import { colors, critterColors, fonts, spacing } from '@/theme/tokens';

export default function PackScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { data: pack, isPending } = usePack(id);
  const counted = useCountedFeeds();
  const feed = usePackFeed(id);
  const pending = usePendingFeeds(id);
  const now = useNow(30_000);
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
  const fed = fedToday(counted.data, pack, now);
  const iFed = members.some((member) => member.user_id === session?.user.id && fed.has(member.user_id));
  const awake = members.filter((member) => member.status === 'active');
  const fedCount = awake.filter((member) => fed.has(member.user_id)).length;
  const names = new Map(pack.pack_members.map((member) => [member.user_id, member.profiles?.display_name ?? null]));
  const focusable = pack.category === 'study' || pack.category === 'reading';
  const pendingCount = pending.data?.length ?? 0;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <AppText variant="caption">{t('pack.back')}</AppText>
        </Pressable>
        <View style={styles.headerLinks}>
          {members.length < PACK_SIZE_MAX && (
            <Pressable accessibilityRole="button" onPress={() => router.push(`/pack/${id}/invite`)} hitSlop={12}>
              <AppText variant="caption">{t('pack.invite')}</AppText>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={() => router.push(`/pack/${id}/settings`)} hitSlop={12}>
            <AppText variant="caption">{t('pack.settings')}</AppText>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <AppText variant="heading" style={styles.centerText}>
          {pack.name}
        </AppText>
        <AppText variant="caption" style={styles.centerText}>
          {categoryInfo(pack.category).emoji} {habit} · {t('packs.restDays', { count: pack.rest_days_per_week })}
        </AppText>

        {pack.critters && (
          <CritterPanel
            pack={pack}
            critter={pack.critters}
            memberCount={members.length}
            mood={awake.length > 0 ? fedCount / awake.length : 0}
            now={now}
          />
        )}

        <View style={styles.membersHeader}>
          <AppText variant="caption">{t('pack.members')}</AppText>
          <AppText variant="caption">{t('pack.fedCount', { fed: fedCount, total: awake.length })}</AppText>
        </View>
        <MemberCircles
          color={pack.critters ? critterColors[pack.critters.color] : colors.accent}
          members={members.map((member) => ({
            id: member.user_id,
            name: member.profiles?.display_name ?? null,
            state: memberState(member, fed),
          }))}
        />
        {pendingCount > 0 && (
          <AppText variant="caption" style={styles.centerText}>
            {t('pack.pending', { count: pendingCount })}
          </AppText>
        )}

        <AppText variant="heading">{t('pack.feedTitle')}</AppText>
        {feed.data && <FeedList feeds={feed.data} names={names} emoji={categoryInfo(pack.category).emoji} now={now} />}
      </ScrollView>

      <View style={styles.actions}>
        <View style={styles.mainAction}>
          {iFed ? (
            <Button label={t('pack.postExtra')} variant="secondary" onPress={() => router.push(`/pack/${id}/feed?extra=1`)} />
          ) : (
            <Button label={t('pack.feed')} onPress={() => router.push(`/pack/${id}/feed`)} />
          )}
        </View>
        {focusable && (
          <View style={styles.sideAction}>
            <Button label={t('pack.focus')} variant="secondary" onPress={() => router.push(`/pack/${id}/focus`)} />
          </View>
        )}
      </View>
    </Screen>
  );
}

function memberState(member: PackMember, fed: Set<string>): MemberState {
  if (fed.has(member.user_id)) return 'fed';
  return member.status === 'sleeping' ? 'asleep' : 'waiting';
}

type PanelProps = { pack: Pack; critter: PackCritter; memberCount: number; mood: number; now: Date };

function CritterPanel({ pack, critter, memberCount, mood, now }: PanelProps) {
  const { t } = useTranslation();
  const art = critterArt(critter, { category: pack.category, now, mood, cracking: memberCount >= 2 });
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
  headerLinks: { flexDirection: 'row', gap: spacing.lg },
  membersHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  mainAction: { flex: 2 },
  sideAction: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
  critter: { alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  note: { fontFamily: fonts.heading, fontSize: 18 },
  stats: { alignSelf: 'stretch', gap: spacing.xs, paddingHorizontal: spacing.lg },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
