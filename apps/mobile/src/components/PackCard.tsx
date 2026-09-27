import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { HealthBar } from '@/components/HealthBar';
import { Critter } from '@/features/critter/Critter';
import { critterArt } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { currentMembers, type Pack, type PackCritter } from '@/features/packs/api';
import { categoryInfo } from '@/features/packs/constants';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  pack: Pack;
  now: Date;
  /** Members who fed on the pack's current day. */
  fed: Set<string>;
  userId: string | undefined;
  onPress: () => void;
  onFeed: () => void;
};

export function PackCard({ pack, now, fed, userId, onPress, onFeed }: Props) {
  const { t } = useTranslation();
  const members = currentMembers(pack);
  const awake = members.filter((member) => member.status === 'active');
  const fedCount = awake.filter((member) => fed.has(member.user_id)).length;
  const iFed = userId !== undefined && fed.has(userId);
  const category = categoryInfo(pack.category);
  const habit = pack.custom_habit ?? t(`packs.categories.${pack.category}`);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {pack.critters && (
        <CardCritter
          pack={pack}
          critter={pack.critters}
          memberCount={members.length}
          mood={awake.length > 0 ? fedCount / awake.length : 0}
          now={now}
        />
      )}
      <View style={styles.text}>
        <AppText variant="heading" numberOfLines={1}>
          {pack.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {category.emoji} {habit} · {t('packs.members', { count: members.length })}
        </AppText>
        {pack.critters && pack.critters.status === 'active' && (
          <View style={styles.health}>
            <HealthBar health={pack.critters.health} height={8} style={styles.bar} />
            <AppText variant="caption">{t('critter.streak', { count: pack.critters.streak })}</AppText>
          </View>
        )}
        {members.length >= 2 && (
          <AppText variant="caption">{t('pack.fedCount', { fed: fedCount, total: awake.length })}</AppText>
        )}
      </View>
      {iFed ? (
        <View style={styles.done} accessible accessibilityLabel={t('pack.fed')}>
          <AppText style={styles.doneText}>✓</AppText>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.feedPack', { name: pack.name })}
          onPress={onFeed}
          hitSlop={8}
          style={({ pressed }) => [styles.feed, pressed && styles.pressed]}>
          <AppText style={styles.feedText}>{t('pack.feed')}</AppText>
        </Pressable>
      )}
    </Pressable>
  );
}

type CardCritterProps = { pack: Pack; critter: PackCritter; memberCount: number; mood: number; now: Date };

function CardCritter({ pack, critter, memberCount, mood, now }: CardCritterProps) {
  const art = critterArt(critter, { category: pack.category, now, mood, cracking: memberCount >= 2 });
  const { label } = useCritterText(critter, art);
  return <Critter art={art} size={72} label={label} animated={false} />;
}

const styles = StyleSheet.create({
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
  pressed: { transform: [{ scale: 0.98 }] },
  text: { flex: 1, gap: 2 },
  health: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  bar: { flex: 1 },
  feed: {
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedText: { color: colors.onAccent, fontFamily: fonts.bodyMedium },
  done: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 18 },
});
