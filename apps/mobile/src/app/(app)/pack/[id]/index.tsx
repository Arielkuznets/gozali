import { dayEnd, packDayOf } from '@gozali/game-engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { HealthBar } from '@/components/HealthBar';
import { MemberCircles, type MemberState } from '@/components/MemberCircles';
import { Screen } from '@/components/Screen';
import { LoadingScreen, LoadFailedScreen, PackMissingScreen } from '@/components/ScreenStates';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAvatarUrls } from '@/features/profile/avatar';
import { Critter } from '@/features/critter/Critter';
import { critterArt, stageProgress } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { useDayStatus, useTodayPasses, type TodayPasses } from '@/features/days/api';
import { FeedList } from '@/features/feeds/FeedList';
import { FEED_PAGE, fedToday, useCountedFeeds, usePackFeed, usePendingFeeds, type FeedItem } from '@/features/feeds/api';
import { countedToday, currentMembers, usePack, type Pack, type PackCritter, type PackMember } from '@/features/packs/api';
import { PACK_SIZE_MAX, categoryInfo } from '@/features/packs/constants';
import { usePackRealtime } from '@/features/packs/realtime';
import { NameMeCard } from '@/features/social/NameMeCard';
import {
  socialErrorKey,
  useBlock,
  useNudge,
  usePackEvents,
  useReact,
  useReport,
  type ReactionKey,
} from '@/features/social/api';
import { formatDay } from '@/lib/dates';
import { goBack } from '@/lib/navigation';
import { useNow } from '@/lib/useNow';
import { colors, critterColors, fonts, spacing } from '@/theme/tokens';

export default function PackScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { data: pack, isPending, isError, refetch } = usePack(id);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [feedLimit, setFeedLimit] = useState(FEED_PAGE);
  const counted = useCountedFeeds();
  const feed = usePackFeed(id, feedLimit);
  const pending = usePendingFeeds(id);
  const now = useNow(30_000);
  const passes = useTodayPasses(pack ?? undefined, now);
  const dayStatus = useDayStatus(id);
  const events = usePackEvents(id, feedLimit);
  const avatars = useAvatarUrls(pack?.pack_members.map((member) => member.profiles?.avatar_path) ?? []);
  const react = useReact();
  const nudge = useNudge(id);
  const report = useReport();
  const blockMember = useBlock();
  usePackRealtime(id);

  if (isPending) return <LoadingScreen />;
  if (!pack && isError) return <LoadFailedScreen onRetry={() => void refetch()} />;
  if (!pack) return <PackMissingScreen />;

  const members = currentMembers(pack);
  const habit = pack.custom_habit ?? t(`packs.categories.${pack.category}`);
  const fed = fedToday(counted.data, pack, now);
  const iFed = members.some((member) => member.user_id === session?.user.id && fed.has(member.user_id));
  const today: TodayPasses = passes.data ?? { passes: new Map(), paused: new Set() };
  // Counted today: not asleep and not on a pause.
  const awake = countedToday(pack, today.paused);
  const fedCount = awake.filter((member) => fed.has(member.user_id)).length;
  const names = new Map(pack.pack_members.map((member) => [member.user_id, member.profiles?.display_name ?? null]));
  const focusable = pack.category === 'study' || pack.category === 'reading';
  const pendingCount = pending.data?.length ?? 0;
  const pausedToday = Boolean(dayStatus.data?.pause && dayStatus.data.pause.startsOn <= dayStatus.data.day);
  const userId = session?.user.id;
  const critterName = pack.critters?.name ?? (pack.critters ? t(`packs.species.${pack.critters.species}`) : '');
  const admin = members.find((member) => member.role === 'admin');
  const isAdmin = admin?.user_id === userId;
  const fail = (error: unknown) => Alert.alert(t(socialErrorKey(error)));
  const morePhotos = (feed.data?.length ?? 0) >= feedLimit;
  // While older photos remain unloaded, older events wait too, so the merged list has no gap.
  const oldestPhoto = feed.data?.at(-1)?.created_at;
  const shownEvents = (events.data ?? []).filter((event) => !morePhotos || !oldestPhoto || event.created_at >= oldestPhoto);

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const block = (memberId: string, name: string) => {
    if (!userId) return;
    Alert.alert(t('social.blockTitle', { name }), t('social.blockBody'), [
      { text: t('social.cancel'), style: 'cancel' },
      {
        text: t('social.block', { name }),
        style: 'destructive',
        onPress: () =>
          blockMember.mutate(
            { blockerId: userId, blockedId: memberId },
            { onSuccess: () => Alert.alert(t('social.blockedLeave')), onError: fail },
          ),
      },
    ]);
  };

  const onMemberMenu = (member: { id: string; name: string | null; nudgeable?: boolean }) => {
    if (member.id === userId) return;
    const name = member.name ?? '…';
    Alert.alert(t('pack.memberMenu', { name }), undefined, [
      ...(member.nudgeable ? [{ text: t('social.nudge'), onPress: () => onNudge(member) }] : []),
      { text: t('social.block', { name }), style: 'destructive' as const, onPress: () => block(member.id, name) },
      { text: t('social.cancel'), style: 'cancel' as const },
    ]);
  };

  const onNudge = (member: { id: string; name: string | null }) => {
    const name = member.name ?? '…';
    Alert.alert(t('social.nudgeTitle', { name }), t('social.nudgeBody', { critter: critterName }), [
      { text: t('social.cancel'), style: 'cancel' },
      {
        text: t('social.nudge'),
        onPress: () => nudge.mutate(member.id, { onSuccess: () => Alert.alert(t('social.nudged')), onError: fail }),
      },
    ]);
  };

  const onReact = (item: FeedItem, emoji: ReactionKey | null) => react.mutate({ feedId: item.id, emoji }, { onError: fail });

  const onMore = (item: FeedItem) => {
    if (!userId) return;
    const name = names.get(item.user_id) ?? '…';
    Alert.alert(name, undefined, [
      {
        text: t('social.report'),
        onPress: () =>
          Alert.alert(t('social.reportTitle'), t('social.reportBody'), [
            { text: t('social.cancel'), style: 'cancel' },
            {
              text: t('social.report'),
              style: 'destructive',
              onPress: () =>
                report.mutate(
                  { feedId: item.id, reporterId: userId, reason: null },
                  { onSuccess: () => Alert.alert(t('social.reported')), onError: fail },
                ),
            },
          ]),
      },
      { text: t('social.block', { name }), style: 'destructive', onPress: () => block(item.user_id, name) },
      { text: t('social.cancel'), style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack('/')} hitSlop={12}>
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

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.accent} />}>
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
            state: memberState(member, fed, today),
            avatarUrl: member.profiles?.avatar_path ? avatars.data?.get(member.profiles.avatar_path) : undefined,
            nudgeable:
              member.user_id !== userId &&
              !fed.has(member.user_id) &&
              !today.passes.has(member.user_id) &&
              !today.paused.has(member.user_id),
          }))}
          onNudge={onNudge}
          onMenu={onMemberMenu}
        />
        {pendingCount > 0 && (
          <AppText variant="caption" style={styles.centerText}>
            {t('pack.pending', { count: pendingCount })}
          </AppText>
        )}

        <AppText variant="heading">{t('pack.feedTitle')}</AppText>
        {pack.critters?.status === 'active' && pack.critters.name === null && (
          <NameMeCard
            packId={id}
            critter={critterName}
            isAdmin={isAdmin}
            adminName={admin?.profiles?.display_name ?? '…'}
            names={names}
          />
        )}
        {feed.data && (
          <FeedList
            feeds={feed.data}
            events={shownEvents}
            names={names}
            critterName={critterName}
            emoji={categoryInfo(pack.category).emoji}
            now={now}
            userId={userId}
            onReact={onReact}
            onMore={onMore}
          />
        )}
        {morePhotos && (
          <Button
            label={t('pack.showOlder')}
            variant="secondary"
            size="small"
            onPress={() => setFeedLimit((limit) => limit + FEED_PAGE)}
          />
        )}
      </ScrollView>

      <View style={styles.actions}>
        {pausedToday && dayStatus.data?.pause && (
          <AppText variant="caption" style={styles.centerText}>
            {t('pack.pausedToday', { date: formatDay(dayStatus.data.pause.endsOn) })}
          </AppText>
        )}
        {!iFed && !pausedToday && dayStatus.data?.passToday && (
          <AppText variant="caption" style={styles.centerText}>
            {dayStatus.data.passToday === 'rest' ? t('pack.restingToday') : t('pack.jokerToday')}
          </AppText>
        )}
        {iFed ? (
          <Button label={t('pack.postExtra')} variant="secondary" onPress={() => router.push(`/pack/${id}/feed?extra=1`)} />
        ) : (
          <Button label={t('pack.feed')} onPress={() => router.push(`/pack/${id}/feed`)} />
        )}
        <View style={styles.row}>
          {!iFed && !pausedToday && (
            <View style={styles.fill}>
              <Button
                label={dayStatus.data?.passToday ? t('pack.undo') : t('pack.notToday')}
                variant="secondary"
                size="small"
                onPress={() => router.push(`/pack/${id}/not-today`)}
              />
            </View>
          )}
          {focusable && (
            <View style={styles.fill}>
              <Button
                label={t('pack.focus')}
                variant="secondary"
                size="small"
                onPress={() => router.push(`/pack/${id}/focus`)}
              />
            </View>
          )}
        </View>
      </View>
    </Screen>
  );
}

function memberState(member: PackMember, fed: Set<string>, today: TodayPasses): MemberState {
  if (fed.has(member.user_id)) return 'fed';
  if (today.paused.has(member.user_id)) return 'paused';
  if (member.status === 'sleeping') return 'asleep';
  return today.passes.has(member.user_id) ? 'pass' : 'waiting';
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
      <Pressable accessibilityRole="link" onPress={() => router.push(`/pack/${pack.id}/critter`)} hitSlop={8}>
        <AppText variant="heading">{text.name}</AppText>
        <AppText variant="caption" style={styles.centerText}>
          {t('profile.open')} ›
        </AppText>
      </Pressable>

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
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  fill: { flex: 1 },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
  critter: { alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md },
  note: { fontFamily: fonts.heading, fontSize: 18 },
  stats: { alignSelf: 'stretch', gap: spacing.xs, paddingHorizontal: spacing.lg },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
