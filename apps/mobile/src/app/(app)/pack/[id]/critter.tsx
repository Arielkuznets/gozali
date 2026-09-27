import type { BackgroundItem, HeadItem, NeckItem, Outfit } from '@gozali/critter-art';
import { ACHIEVEMENTS, packDayOf, type WardrobeSlot } from '@gozali/game-engine';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { LoadFailed, LoadingScreen, LoadFailedScreen, PackMissingScreen } from '@/components/ScreenStates';
import { Critter } from '@/features/critter/Critter';
import { critterArt, parseOutfit, stageProgress } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { fedToday, useCountedFeeds } from '@/features/feeds/api';
import { currentMembers, usePack, type Pack, type PackCritter } from '@/features/packs/api';
import { usePackRealtime } from '@/features/packs/realtime';
import { MonthlyBoard } from '@/features/social/MonthlyBoard';
import { socialErrorKey, useAchievements, useBuy, useDress, useMonthResults, usePackItems, useShop, type ShopItem } from '@/features/social/api';
import { confirm, notify } from '@/lib/confirm';
import { formatDay, formatMonth, shiftMonth } from '@/lib/dates';
import { goBack } from '@/lib/navigation';
import { useNow } from '@/lib/useNow';
import { colors, critterAccents, fonts, radii, spacing } from '@/theme/tokens';

const SLOTS: readonly WardrobeSlot[] = ['head', 'neck', 'background'];

/** The critter profile (spec section 9): stage, marks, monthly board, achievements, wardrobe. */
export default function CritterProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending, isError, refetch } = usePack(id);
  usePackRealtime(id);

  if (isPending) return <LoadingScreen />;
  if (!pack && isError) return <LoadFailedScreen onRetry={() => void refetch()} />;
  if (!pack?.critters) return <PackMissingScreen />;
  return <Profile pack={pack} critter={pack.critters} />;
}

function Profile({ pack, critter }: { pack: Pack; critter: PackCritter }) {
  const { t } = useTranslation();
  const now = useNow(60_000);
  const today = packDayOf(now, pack.timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const results = useMonthResults(pack.id, month);
  const achievements = useAchievements(pack.id);
  const counted = useCountedFeeds();
  const dress = useDress(pack.id);
  const buy = useBuy(pack.id);
  const shop = useShop();
  const bought = usePackItems(pack.id);

  const members = currentMembers(pack);
  const art = critterArt(critter, { category: pack.category, now, cracking: members.length >= 2 });
  const text = useCritterText(critter, art);
  const progress = stageProgress(critter.stage);
  const outfit = parseOutfit(critter.outfit);
  const unlocked = achievements.data ?? new Map();
  const canDress = critter.status === 'active';

  const wear = (slot: WardrobeSlot, item: string | null) =>
    dress.mutate({ slot, item }, { onError: (error) => notify(t(socialErrorKey(error))) });

  // The wardrobe: what achievements unlocked, then what the pack bought, per slot.
  const owned = (slot: WardrobeSlot) => [
    ...ACHIEVEMENTS.filter((a) => a.item.slot === slot && unlocked.has(a.key)).map((a) => a.item.key),
    ...(shop.data ?? []).filter((s) => s.slot === slot && bought.data?.has(s.item)).map((s) => s.item),
  ];
  const ownsSomething = SLOTS.some((slot) => owned(slot).length > 0);
  const forSale = (shop.data ?? []).filter((s) => !owned(s.slot).includes(s.item));
  const itemName = (item: string) => t(`items.${item as HeadItem | NeckItem | BackgroundItem}`);

  const offer = (entry: ShopItem) => {
    const name = itemName(entry.item);
    if (critter.coins < entry.price) {
      notify(t('profile.needMore', { count: entry.price - critter.coins, item: name }));
      return;
    }
    confirm({
      title: t('profile.buyTitle', { item: name }),
      message: t('profile.buyBody', { price: entry.price, critter: text.name }),
      confirm: t('profile.buy'),
      cancel: t('profile.cancel'),
      onConfirm: () => buy.mutate(entry.item, { onError: (error) => notify(t(socialErrorKey(error))) }),
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack(`/pack/${pack.id}`)} hitSlop={12}>
          <AppText variant="caption">{t('pack.back')}</AppText>
        </Pressable>
        <AppText variant="heading">{t('profile.title')}</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <Critter art={art} size={180} label={text.label} lines={text.lines} petHint={t('critter.petHint')} />
          <AppText variant="heading">{text.name}</AppText>
          <AppText variant="caption">
            {t(`critter.states.${art.look}`)} · {t(`critter.stages.${critter.stage}`)}
          </AppText>
          {progress && critter.status !== 'egg' && (
            <View style={styles.progress}>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.min(100, ((critter.xp - progress.from) / (progress.to - progress.from)) * 100)}%` },
                  ]}
                />
              </View>
              <AppText variant="caption" style={styles.centerText}>
                {t('critter.xp', { xp: critter.xp, to: progress.to, stage: t(`critter.stages.${progress.next}`) })}
              </AppText>
            </View>
          )}
        </View>

        {critter.marks.length > 0 && (
          <View style={styles.section}>
            <AppText variant="caption">{t('profile.marks')}</AppText>
            {critter.marks.includes('medal') && <AppText>{t('profile.medal')}</AppText>}
            {critter.marks.includes('bandage') && <AppText>{t('profile.bandage')}</AppText>}
          </View>
        )}

        <Pressable accessibilityRole="link" onPress={() => router.push(`/pack/${pack.id}/recap`)} hitSlop={8}>
          <AppText style={styles.sectionTitle}>{t('recap.open')} ›</AppText>
        </Pressable>

        <View style={styles.section}>
          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.previousMonth')}
              onPress={() => setMonth(shiftMonth(month, -1))}
              hitSlop={12}>
              <AppText>‹</AppText>
            </Pressable>
            <AppText style={styles.sectionTitle}>
              {t('profile.board')} · {formatMonth(month)}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('profile.nextMonth')}
              disabled={month >= today.slice(0, 7)}
              onPress={() => setMonth(shiftMonth(month, 1))}
              hitSlop={12}>
              <AppText style={month >= today.slice(0, 7) && styles.disabled}>›</AppText>
            </Pressable>
          </View>
          {results.isError ? (
            <LoadFailed onRetry={() => void results.refetch()} />
          ) : (
            <MonthlyBoard
              month={month}
              results={results.data ?? []}
              members={pack.pack_members
                .filter((member) => member.status !== 'left' || (results.data ?? []).some((r) => r.missed_ids.includes(member.user_id) || r.fed_ids.includes(member.user_id)))
                .map((member) => ({ id: member.user_id, name: member.profiles?.display_name ?? null }))}
              today={today}
              fedToday={fedToday(counted.data, pack, now)}
              color={critterAccents[critter.species]}
            />
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.titleRow}>
            <AppText style={styles.sectionTitle}>{t('profile.wardrobe')}</AppText>
            <AppText variant="caption">{t('profile.coins', { count: critter.coins })}</AppText>
          </View>
          {!ownsSomething && <AppText style={styles.muted}>{t('profile.wardrobeEmpty')}</AppText>}
          {SLOTS.map((slot) => {
            const items = owned(slot);
            if (items.length === 0) return null;
            return (
              <View key={slot} style={styles.slot}>
                <AppText variant="caption">{t(`profile.slots.${slot}`)}</AppText>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items}>
                  {[null, ...items].map((item) => {
                    const worn = (outfit[slot] ?? null) === item;
                    const preview: Outfit = { ...outfit, [slot]: item ?? undefined } as Outfit;
                    return (
                      <Pressable
                        key={item ?? 'none'}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: worn, disabled: !canDress }}
                        accessibilityLabel={item ? itemName(item) : t('profile.none')}
                        disabled={!canDress || worn}
                        onPress={() => wear(slot, item)}
                        style={[styles.item, worn && styles.itemWorn]}>
                        <Critter art={{ ...art, outfit: preview, sleeping: false, mood: 0 }} size={64} label="" animated={false} />
                        <AppText variant="caption" numberOfLines={1}>
                          {item ? itemName(item) : t('profile.none')}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            );
          })}
        </View>

        <View style={styles.section}>
          <AppText style={styles.sectionTitle}>{t('profile.shop')}</AppText>
          <AppText variant="caption">{t('profile.shopBody')}</AppText>
          {shop.data && forSale.length === 0 && <AppText style={styles.muted}>{t('profile.soldOut')}</AppText>}
          <View style={styles.shop}>
            {forSale.map((entry) => {
              const affordable = critter.coins >= entry.price;
              const preview: Outfit = { ...outfit, [entry.slot]: entry.item } as Outfit;
              return (
                <Pressable
                  key={entry.item}
                  accessibilityRole="button"
                  accessibilityLabel={`${itemName(entry.item)}, ${t('critter.coinsLabel', { count: entry.price })}`}
                  onPress={() => offer(entry)}
                  style={[styles.item, styles.shopItem, !affordable && styles.unaffordable]}>
                  <Critter art={{ ...art, outfit: preview, sleeping: false, mood: 0 }} size={64} label="" animated={false} />
                  <AppText variant="caption" numberOfLines={2} style={styles.itemName}>
                    {itemName(entry.item)}
                  </AppText>
                  <AppText style={styles.price}>{t('profile.price', { price: entry.price })}</AppText>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <AppText style={styles.sectionTitle}>{t('profile.achievements')}</AppText>
          {ACHIEVEMENTS.map((achievement) => {
            const at = unlocked.get(achievement.key);
            return (
              <View key={achievement.key} style={[styles.achievement, !at && styles.locked]}>
                <AppText style={styles.badge}>{at ? '🏆' : '🔒'}</AppText>
                <View style={styles.fillText}>
                  <AppText style={styles.achievementTitle}>{t(`achievements.${achievement.key}.title`)}</AppText>
                  <AppText variant="caption">
                    {t(`achievements.${achievement.key}.condition`)} · {t(`items.${achievement.item.key as HeadItem}`)}
                  </AppText>
                </View>
                {at && <AppText variant="caption">{formatDay(at.slice(0, 10))}</AppText>}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  headerSpacer: { width: 32 },
  body: { gap: spacing.lg, paddingBottom: spacing.xl },
  hero: { alignItems: 'center', gap: spacing.xs },
  centerText: { textAlign: 'center' },
  progress: { alignSelf: 'stretch', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.bodyMedium },
  muted: { color: colors.inkMuted },
  monthRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  disabled: { color: colors.border },
  slot: { gap: spacing.xs },
  items: { gap: spacing.sm },
  item: {
    alignItems: 'center',
    width: 84,
    padding: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  itemWorn: { borderColor: colors.accent, borderWidth: 2.5 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  shop: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  unaffordable: { opacity: 0.55 },
  // Three to a row across the whole width, on any phone; a short last row keeps the same size.
  shopItem: { width: undefined, flexBasis: '30%', flexGrow: 1, maxWidth: '32%' },
  itemName: { textAlign: 'center' },
  price: { fontFamily: fonts.bodyMedium, fontSize: 13 },
  achievement: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  locked: { opacity: 0.55 },
  badge: { fontSize: 22, lineHeight: 28 },
  fillText: { flex: 1 },
  achievementTitle: { fontFamily: fonts.bodyMedium },
});
