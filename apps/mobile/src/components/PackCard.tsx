import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { CritterPlaceholder } from '@/components/CritterPlaceholder';
import { currentMembers, type Pack } from '@/features/packs/api';
import { categoryInfo } from '@/features/packs/constants';
import { colors, critterColors, radii, spacing } from '@/theme/tokens';

export function PackCard({ pack, onPress }: { pack: Pack; onPress: () => void }) {
  const { t } = useTranslation();
  const members = currentMembers(pack);
  const critter = pack.critters;
  const category = categoryInfo(pack.category);
  const habit = pack.custom_habit ?? t(`packs.categories.${pack.category}`);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {critter && (
        <CritterPlaceholder
          label={critter.name ?? t(`packs.species.${critter.species}`)}
          size={56}
          color={critterColors[critter.color]}
          species={critter.species}
          status={critter.status}
          cracking={members.length >= 2}
        />
      )}
      <View style={styles.text}>
        <AppText variant="heading" numberOfLines={1}>
          {pack.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {category.emoji} {habit} · {t('packs.members', { count: members.length })}
        </AppText>
      </View>
    </Pressable>
  );
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
});
