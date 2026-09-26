import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { CritterPlaceholder } from '@/components/CritterPlaceholder';
import { MemberCircles } from '@/components/MemberCircles';
import { Screen } from '@/components/Screen';
import { currentMembers, usePack } from '@/features/packs/api';
import { PACK_SIZE_MAX, categoryInfo } from '@/features/packs/constants';
import { colors, critterColors, spacing } from '@/theme/tokens';

export default function PackScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending } = usePack(id);

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
  const critter = pack.critters;
  const critterName = critter ? (critter.name ?? t(`packs.species.${critter.species}`)) : '';
  const isEgg = critter?.status === 'egg';
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

        {critter && (
          <View style={styles.critter}>
            <CritterPlaceholder
              label={t('pack.critterLabel', { name: critterName })}
              size={180}
              color={critterColors[critter.color]}
              species={critter.species}
              status={critter.status}
              cracking={members.length >= 2}
            />
            <AppText variant="heading">{critterName}</AppText>
            {isEgg && (
              <AppText style={[styles.centerText, styles.muted]}>
                {members.length >= 2 ? t('pack.eggCracking') : t('pack.eggWaiting')}
              </AppText>
            )}
          </View>
        )}

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

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted },
  critter: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
});
