import { critterArtFor, renderCritter } from '@gozali/critter-art';
import { Image } from 'expo-image';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import type { RecapPhoto, RecapStats } from '@/features/recap/api';
import type { Category } from '@/features/packs/constants';
import { formatDay } from '@/lib/dates';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/** Drawn at 360 x 640 and captured at 3x, the 1080 x 1920 story size. */
export const STORY_WIDTH = 360;
export const STORY_HEIGHT = 640;

type Props = {
  packName: string;
  category: Category;
  stats: RecapStats;
  /** Only the sharing member's own photos: the story leaves the pack (spec section 7). */
  photos: RecapPhoto[];
};

export const StoryCard = forwardRef<View, Props>(function StoryCard({ packName, category, stats, photos }, ref) {
  const { t } = useTranslation();
  const art = critterArtFor(stats.critter, { category, mood: 1, sleeping: false });
  const change = stats.healthEnd - stats.healthStart;
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <AppText style={styles.brand}>Gozali</AppText>
      <View style={styles.top}>
        <AppText style={styles.pack}>{packName}</AppText>
        <AppText variant="caption">{t('recap.weekOf', { date: formatDay(stats.weekStart) })}</AppText>
      </View>
      <SvgXml xml={renderCritter(art)} width={220} height={220} />
      <AppText style={styles.name}>{stats.critter.name ?? t(`packs.species.${stats.critter.species}`)}</AppText>
      <View style={styles.numbers}>
        <Stat value={`${stats.successDays}/${stats.days}`} label={t('recap.goodDays')} />
        <Stat value={`${change >= 0 ? '+' : ''}${change}`} label={t('recap.health')} />
        <Stat value={`🔥 ${stats.critter.streak}`} label={t('recap.streak')} />
      </View>
      {photos.length > 0 && (
        <View style={styles.photos}>
          {photos.slice(0, 3).map((photo) => (
            <Image key={photo.id} source={{ uri: photo.url, cacheKey: photo.id }} style={styles.photo} contentFit="cover" />
          ))}
        </View>
      )}
      <AppText style={styles.footer}>{t('recap.storyFooter')}</AppText>
    </View>
  );
});

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.number}>
      <AppText style={styles.value}>{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  brand: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 30, color: colors.accent },
  top: { alignItems: 'center', gap: 2 },
  pack: { fontFamily: fonts.heading, fontSize: 26, lineHeight: 32 },
  name: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 28 },
  numbers: { flexDirection: 'row', gap: spacing.sm },
  number: {
    alignItems: 'center',
    minWidth: 92,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: { fontFamily: fonts.bodyBold, fontSize: 20, lineHeight: 26 },
  photos: { flexDirection: 'row', gap: spacing.sm },
  photo: { width: 96, height: 128, borderRadius: radii.md, backgroundColor: colors.border },
  footer: { fontFamily: fonts.bodyMedium, color: colors.inkMuted },
});
