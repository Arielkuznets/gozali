import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PackCard } from '@/components/PackCard';
import { Screen } from '@/components/Screen';
import { useAuth } from '@/features/auth/AuthProvider';
import { Critter } from '@/features/critter/Critter';
import { fedToday, useCountedFeeds } from '@/features/feeds/api';
import { useMyPacks } from '@/features/packs/api';
import { usePackRealtime } from '@/features/packs/realtime';
import { useNow } from '@/lib/useNow';
import { colors, critterColors, spacing } from '@/theme/tokens';

const PACK_LIMIT = 3;

export default function HomeScreen() {
  const { t } = useTranslation();
  const { data: packs, isPending } = useMyPacks();
  const counted = useCountedFeeds();
  const { session } = useAuth();
  usePackRealtime();
  const now = useNow(60_000);


  const hasPacks = packs !== undefined && packs.length > 0;
  const atLimit = packs !== undefined && packs.length >= PACK_LIMIT;

  return (
    <Screen>
      <View style={styles.header}>
        <AppText variant="heading">{t('home.title')}</AppText>
        <Pressable accessibilityRole="button" onPress={() => router.push('/me')} hitSlop={12}>
          <AppText variant="caption">{t('me.open')}</AppText>
        </Pressable>
      </View>

      {isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : hasPacks ? (
        <ScrollView contentContainerStyle={styles.list}>
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              now={now}
              fed={fedToday(counted.data, pack, now)}
              userId={session?.user.id}
              onPress={() => router.push(`/pack/${pack.id}`)}
              onFeed={() => router.push(`/pack/${pack.id}/feed`)}
            />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.center}>
          <Critter
            art={{ species: 'blob', color: critterColors.butter, stage: 'egg', look: 'egg' }}
            size={140}
            label={t('home.eggLabel')}
          />
          <AppText variant="heading" style={styles.centerText}>
            {t('home.emptyTitle')}
          </AppText>
          <AppText style={[styles.centerText, styles.muted]}>{t('home.emptyBody')}</AppText>
        </View>
      )}

      <View style={styles.actions}>
        {atLimit ? (
          <AppText variant="caption" style={styles.centerText}>
            {t('home.limitReached')}
          </AppText>
        ) : (
          <>
            <Button label={t('home.createPack')} onPress={() => router.push('/create-pack')} />
            <Button label={t('home.joinPack')} variant="secondary" onPress={() => router.push('/join')} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  list: { gap: spacing.sm, paddingBottom: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  centerText: { textAlign: 'center' },
  muted: { color: colors.inkMuted, maxWidth: 300 },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
