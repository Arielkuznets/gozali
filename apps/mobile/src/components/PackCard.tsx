import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { HealthBar } from '@/components/HealthBar';
import { Critter } from '@/features/critter/Critter';
import { critterArt } from '@/features/critter/art';
import { useCritterText } from '@/features/critter/useCritterText';
import { currentMembers, type Pack, type PackCritter } from '@/features/packs/api';
import { categoryInfo } from '@/features/packs/constants';
import { colors, radii, spacing } from '@/theme/tokens';

export function PackCard({ pack, now, onPress }: { pack: Pack; now: Date; onPress: () => void }) {
  const { t } = useTranslation();
  const members = currentMembers(pack);
  const category = categoryInfo(pack.category);
  const habit = pack.custom_habit ?? t(`packs.categories.${pack.category}`);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {pack.critters && <CardCritter pack={pack} critter={pack.critters} memberCount={members.length} now={now} />}
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
      </View>
    </Pressable>
  );
}

function CardCritter({ pack, critter, memberCount, now }: { pack: Pack; critter: PackCritter; memberCount: number; now: Date }) {
  const art = critterArt(critter, { category: pack.category, now, cracking: memberCount >= 2 });
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
});
