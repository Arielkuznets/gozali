import { ACHIEVEMENTS } from '@gozali/game-engine';
import { critterArtFor } from '@gozali/critter-art';
import * as Sharing from 'expo-sharing';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { LoadFailed, LoadFailedScreen, LoadingScreen, PackMissingScreen } from '@/components/ScreenStates';
import { useAuth } from '@/features/auth/AuthProvider';
import { Critter } from '@/features/critter/Critter';
import { PhotoViewer, type ViewedPhoto } from '@/features/feeds/PhotoViewer';
import { usePack } from '@/features/packs/api';
import { StoryCard, STORY_HEIGHT, STORY_WIDTH } from '@/features/recap/StoryCard';
import { useRecapPhotos, useRecaps, type Recap } from '@/features/recap/api';
import { formatDay } from '@/lib/dates';
import { goBack } from '@/lib/navigation';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/** The weekly recap (spec section 7) and sharing it as a story. */
export default function RecapScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending, isError, refetch } = usePack(id);
  const recaps = useRecaps(id);
  const [week, setWeek] = useState<string | null>(null);

  const recap = recaps.data?.find((item) => item.week_start === week) ?? recaps.data?.[0];

  if (isPending) return <LoadingScreen />;
  if (!pack && isError) return <LoadFailedScreen onRetry={() => void refetch()} />;
  if (!pack) return <PackMissingScreen />;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => goBack(`/pack/${id}`)} hitSlop={12}>
          <AppText variant="caption">{t('pack.back')}</AppText>
        </Pressable>
        <AppText variant="heading">{t('recap.title')}</AppText>
        <View style={styles.headerSpacer} />
      </View>

      {recaps.isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !recap && recaps.isError ? (
        <LoadFailed onRetry={() => void recaps.refetch()} />
      ) : !recap ? (
        <View style={styles.center}>
          <AppText style={styles.muted}>{t('recap.none')}</AppText>
        </View>
      ) : (
        <>
          {recaps.data && recaps.data.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeks}>
              {recaps.data.map((item) => (
                <Choice
                  key={item.week_start}
                  label={formatDay(item.week_start)}
                  selected={item.week_start === recap.week_start}
                  onPress={() => setWeek(item.week_start)}>
                  <AppText variant="caption">{formatDay(item.week_start)}</AppText>
                </Choice>
              ))}
            </ScrollView>
          )}
          <RecapView recap={recap} packName={pack.name} category={pack.category} names={new Map(pack.pack_members.map((m) => [m.user_id, m.profiles?.display_name ?? null]))} />
        </>
      )}
    </Screen>
  );
}

type ViewProps = {
  recap: Recap;
  packName: string;
  category: Parameters<typeof critterArtFor>[1]['category'];
  names: Map<string, string | null>;
};

function RecapView({ recap, packName, category, names }: ViewProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const photos = useRecapPhotos(recap);
  const story = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const [open, setOpen] = useState<ViewedPhoto | null>(null);
  const stats = recap.stats;
  const art = critterArtFor(stats.critter, { category, mood: 1, sleeping: false });
  const change = stats.healthEnd - stats.healthStart;
  const mine = (photos.data ?? []).filter((photo) => photo.userId === session?.user.id);
  const top = stats.topMembers.map((member) => names.get(member) ?? '…').join(', ');

  const share = async () => {
    if (!story.current) return;
    setSharing(true);
    try {
      const uri = await captureRef(story, { format: 'png', quality: 1, width: 1080, height: 1920 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('recap.share'), UTI: 'public.png' });
    } catch {
      Alert.alert(t('recap.shareFailed'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        <AppText style={styles.centerText} variant="caption">
          {t('recap.weekOf', { date: formatDay(stats.weekStart) })}
        </AppText>
        <View style={styles.hero}>
          <Critter art={art} size={160} label={stats.critter.name ?? t(`packs.species.${stats.critter.species}`)} animated={false} />
        </View>
        <View style={styles.stats}>
          <Stat value={`${stats.successDays}/${stats.days}`} label={t('recap.goodDays')} />
          <Stat value={`${change >= 0 ? '+' : ''}${change}`} label={t('recap.health')} />
          <Stat value={`🔥 ${stats.critter.streak}`} label={t('recap.streak')} />
        </View>
        {stats.topMembers.length > 0 && (
          <AppText style={styles.centerText}>{t('recap.mostConsistent', { names: top, count: stats.topFeeds })}</AppText>
        )}
        {stats.achievements.map((key) => (
          <AppText key={key} style={styles.centerText}>
            🏆 {t(`achievements.${key}.title`)} ·{' '}
            {t(`items.${(ACHIEVEMENTS.find((a) => a.key === key)?.item.key ?? 'scarf') as 'scarf'}`)}
          </AppText>
        ))}
        {photos.data && photos.data.length > 0 && (
          <View style={styles.collage}>
            {photos.data.map((photo) => {
              const name = names.get(photo.userId) ?? '…';
              return (
                <Pressable
                  key={photo.id}
                  style={styles.tile}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('feed.photoBy', { name })}
                  accessibilityHint={t('feed.openPhoto')}
                  onPress={() => setOpen({ id: photo.id, url: photo.url, caption: null, name })}>
                  <Image source={{ uri: photo.url, cacheKey: photo.id }} style={styles.fill} contentFit="cover" />
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
      <PhotoViewer photo={open} onClose={() => setOpen(null)} />

      {Platform.OS !== 'web' && (
        <Button label={t('recap.share')} loading={sharing} onPress={() => void share()} />
      )}

      {/* Off screen: the story image that gets captured. */}
      <View style={styles.offscreen} pointerEvents="none">
        <StoryCard ref={story} packName={packName} category={category} stats={stats} photos={mine} />
      </View>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <AppText style={styles.statValue}>{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  headerSpacer: { width: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.inkMuted, textAlign: 'center' },
  centerText: { textAlign: 'center' },
  weeks: { gap: spacing.sm, paddingBottom: spacing.sm },
  body: { gap: spacing.md, paddingBottom: spacing.lg },
  hero: { alignItems: 'center' },
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
  statValue: { fontFamily: fonts.heading, fontSize: 26, lineHeight: 34 },
  collage: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tile: { width: '32.5%', aspectRatio: 3 / 4, borderRadius: radii.sm, overflow: 'hidden', backgroundColor: colors.border },
  fill: { width: '100%', height: '100%' },
  offscreen: { position: 'absolute', left: -STORY_WIDTH * 3, top: 0, width: STORY_WIDTH, height: STORY_HEIGHT },
});
