import { ACHIEVEMENTS } from '@gozali/game-engine';
import { critterArtFor } from '@gozali/critter-art';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { AppText } from '@/components/AppText';
import { Coins } from '@/components/Coins';
import { HeaderButton } from '@/components/HeaderButton';
import { Button } from '@/components/Button';
import { Choice } from '@/components/Choice';
import { Screen } from '@/components/Screen';
import { LoadFailed, LoadFailedScreen, LoadingScreen, PackMissingScreen } from '@/components/ScreenStates';
import { useAuth } from '@/features/auth/AuthProvider';
import { Critter } from '@/features/critter/Critter';
import { PhotoViewer, type ViewedPhoto } from '@/features/feeds/PhotoViewer';
import { SignedPhoto } from '@/features/feeds/SignedPhoto';
import { usePack } from '@/features/packs/api';
import { StoryCard, STORY_HEIGHT, STORY_PHOTOS, STORY_WIDTH } from '@/features/recap/StoryCard';
import { useRecapPhotos, useRecaps, type Recap } from '@/features/recap/api';
import { notify } from '@/lib/confirm';
import { formatDayAcrossYears } from '@/lib/dates';
import { goBack } from '@/lib/navigation';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/** The weeks a screen reader passes on its way to the recap; the earlier ones wait behind a button. */
const RECENT_WEEKS = 12;

/** The weekly recap (spec section 7) and sharing it as a story. */
export default function RecapScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending, isError, refetch } = usePack(id);
  const recaps = useRecaps(id);
  const [week, setWeek] = useState<string | null>(null);
  const [allWeeks, setAllWeeks] = useState(false);

  const recap = recaps.data?.find((item) => item.week_start === week) ?? recaps.data?.[0];

  if (isPending) return <LoadingScreen back />;
  if (!pack && isError) return <LoadFailedScreen onRetry={() => void refetch()} />;
  if (!pack) return <PackMissingScreen />;

  return (
    <Screen>
      <View style={styles.header}>
        <HeaderButton icon="‹" label={t('pack.back')} onPress={() => goBack(`/pack/${id}`)} />
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
          {/* Days close once a second member has joined, even one who has left since. */}
          <AppText style={styles.muted}>{t(pack.pack_members.length < 2 ? 'recap.noneAlone' : 'recap.none')}</AppText>
        </View>
      ) : (
        <>
          {recaps.data && recaps.data.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekRow} contentContainerStyle={styles.weeks}>
              {(allWeeks ? recaps.data : recaps.data.slice(0, RECENT_WEEKS)).map((item) => (
                <Choice
                  key={item.week_start}
                  label={formatDayAcrossYears(item.week_start)}
                  selected={item.week_start === recap.week_start}
                  onPress={() => setWeek(item.week_start)}>
                  <AppText variant="caption">{formatDayAcrossYears(item.week_start)}</AppText>
                </Choice>
              ))}
              {!allWeeks && recaps.data.length > RECENT_WEEKS && (
                <Button label={t('recap.earlierWeeks')} variant="secondary" size="small" onPress={() => setAllWeeks(true)} />
              )}
            </ScrollView>
          )}
          <RecapView recap={recap} category={pack.category} names={new Map(pack.pack_members.map((m) => [m.user_id, m.profiles?.display_name ?? null]))} />
        </>
      )}
    </Screen>
  );
}

/** How long Share waits for the story's photos: one that never answers can't hold it for good. */
const STORY_PHOTOS_LIMIT_MS = 8000;

type ViewProps = {
  recap: Recap;
  category: Parameters<typeof critterArtFor>[1]['category'];
  names: Map<string, string | null>;
};

function RecapView({ recap, category, names }: ViewProps) {
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
  const photosFailed = photos.isError && !photos.data;
  // A photo still on its way would be an empty box in the image, so Share waits for each of the
  // story's photos to load or fail.
  const [loadEnded, setLoadEnded] = useState<ReadonlySet<string>>(() => new Set());
  const inStory = mine.slice(0, STORY_PHOTOS);
  const storyIds = inStory.map((photo) => photo.id).join();
  const [waitedFor, setWaitedFor] = useState<string | null>(null);
  useEffect(() => {
    if (storyIds === '') return;
    const timer = setTimeout(() => setWaitedFor(storyIds), STORY_PHOTOS_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [storyIds]);
  const storyLoading = photos.isLoading || (waitedFor !== storyIds && inStory.some((photo) => !loadEnded.has(photo.id)));
  // A deleted account takes its member row along, and the recap keeps its id: only those still
  // here are named.
  const top = stats.topMembers.flatMap((member) => (names.has(member) ? [names.get(member) ?? '…'] : []));

  const share = async () => {
    if (!story.current) return;
    setSharing(true);
    try {
      // A story is 1080 x 1920 pixels. iOS takes the size in points and draws at the screen's scale;
      // Android takes pixels.
      const scale = Platform.OS === 'ios' ? PixelRatio.get() : 1;
      const uri = await captureRef(story, { format: 'png', quality: 1, width: 1080 / scale, height: 1920 / scale });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('recap.share'), UTI: 'public.png' });
    } catch {
      notify(t('recap.shareFailed'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.body}>
        <AppText style={styles.centerText} variant="caption">
          {t('recap.weekOf', { date: formatDayAcrossYears(stats.weekStart) })}
        </AppText>
        <View style={styles.hero}>
          <Critter art={art} size={160} label={stats.critter.name ?? t(`packs.species.${stats.critter.species}`)} animated={false} />
        </View>
        <View style={styles.stats}>
          <Stat value={`${stats.successDays}/${stats.days}`} label={t('recap.goodDays')} />
          <Stat value={`${change >= 0 ? '+' : ''}${change}`} label={t('recap.health')} />
          <Stat value={`🔥 ${stats.critter.streak}`} label={t('recap.streak')} />
        </View>
        {(stats.coins ?? 0) > 0 && (
          <View style={styles.centerRow}>
            <Coins text={t('recap.coins', { count: stats.coins })} variant="body" />
          </View>
        )}
        {top.length > 0 && (
          <AppText style={styles.centerText}>{t('recap.mostConsistent', { names: top.join(', '), count: stats.topFeeds })}</AppText>
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
                  onPress={() => setOpen({ id: photo.id, userId: photo.userId, url: photo.url, caption: null, name })}>
                  <SignedPhoto id={photo.id} url={photo.url} style={styles.fill} contentFit="cover" transition={200} />
                </Pressable>
              );
            })}
          </View>
        )}
        {photosFailed && <LoadFailed onRetry={() => void photos.refetch()} />}
      </ScrollView>
      <PhotoViewer photo={open} onClose={() => setOpen(null)} />

      {/* The story holds the member's own photos, so it waits for them. */}
      {Platform.OS !== 'web' && (
        <Button label={t('recap.share')} loading={sharing || storyLoading} disabled={photosFailed} onPress={() => void share()} />
      )}

      {/* Off screen, and kept from screen readers, which would read it after the recap: the story
          image that gets captured. */}
      <View style={styles.offscreen} pointerEvents="none" aria-hidden>
        <StoryCard
          ref={story}
          category={category}
          stats={stats}
          photos={mine}
          onPhotoLoadEnd={(id) => setLoadEnded((ended) => (ended.has(id) ? ended : new Set(ended).add(id)))}
        />
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
  centerRow: { alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  headerSpacer: { width: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: colors.inkMuted, textAlign: 'center' },
  centerText: { textAlign: 'center' },
  // A horizontal list in a column grows to fill the height unless told not to.
  weekRow: { flexGrow: 0 },
  weeks: { gap: spacing.sm, paddingBottom: spacing.sm, alignItems: 'center' },
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
  // Three tiles and their two gaps fit in a row down to a 320 wide screen.
  tile: { width: '32%', aspectRatio: 3 / 4, borderRadius: radii.sm, overflow: 'hidden', backgroundColor: colors.border },
  fill: { width: '100%', height: '100%' },
  offscreen: { position: 'absolute', left: -STORY_WIDTH * 3, top: 0, width: STORY_WIDTH, height: STORY_HEIGHT },
});
