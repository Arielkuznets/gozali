import { critterArtFor, renderCritter } from '@gozali/critter-art';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { SignedPhoto } from '@/features/feeds/SignedPhoto';
import type { RecapPhoto, RecapStats } from '@/features/recap/api';
import type { Category } from '@/features/packs/constants';
import { formatDayAcrossYears } from '@/lib/dates';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/** Drawn at 360 x 640, a third of the 1080 x 1920 pixels the story is captured at. */
export const STORY_WIDTH = 360;
export const STORY_HEIGHT = 640;
/** How many of the member's photos fit in the story's row. */
export const STORY_PHOTOS = 3;

type Props = {
  category: Category;
  stats: RecapStats;
  /** Only the sharing member's own photos: the story leaves the pack (spec section 7). */
  photos: RecapPhoto[];
  /** One of the story's photos has loaded, or couldn't. */
  onPhotoLoadEnd?: (id: string) => void;
};

/**
 * The story leaves the pack: besides the logo and the link, it holds only the pet, the pack's
 * numbers and the member's own photos (spec section 7).
 *
 * It is a picture of a fixed size, so its text keeps its size whatever the phone's text setting:
 * grown text would push the link and the photos off its bottom.
 */
export const StoryCard = forwardRef<View, Props>(function StoryCard({ category, stats, photos, onPhotoLoadEnd }, ref) {
  const { t } = useTranslation();
  const art = critterArtFor(stats.critter, { category, mood: 1, sleeping: false });
  const change = stats.healthEnd - stats.healthStart;
  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.top}>
        <AppText style={styles.brand} maxFontSizeMultiplier={1}>Gozali</AppText>
        <AppText variant="caption" maxFontSizeMultiplier={1}>{t('recap.weekOf', { date: formatDayAcrossYears(stats.weekStart) })}</AppText>
      </View>
      <SvgXml xml={renderCritter(art)} width={220} height={220} />
      <AppText style={styles.name} maxFontSizeMultiplier={1}>{stats.critter.name ?? t(`packs.species.${stats.critter.species}`)}</AppText>
      <View style={styles.numbers}>
        <Stat value={`${stats.successDays}/${stats.days}`} label={t('recap.goodDays')} />
        <Stat value={`${change >= 0 ? '+' : ''}${change}`} label={t('recap.health')} />
        <Stat value={`🔥 ${stats.critter.streak}`} label={t('recap.streak')} />
      </View>
      {photos.length > 0 && (
        <View style={styles.photos}>
          {photos.slice(0, STORY_PHOTOS).map((photo) => (
            <SignedPhoto
              key={photo.id}
              id={photo.id}
              url={photo.url}
              style={styles.photo}
              contentFit="cover"
              onLoadEnd={() => onPhotoLoadEnd?.(photo.id)}
            />
          ))}
        </View>
      )}
      <AppText style={styles.footer} maxFontSizeMultiplier={1}>{t('recap.storyFooter')}</AppText>
    </View>
  );
});

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.number}>
      <AppText style={styles.value} maxFontSizeMultiplier={1}>{value}</AppText>
      <AppText variant="caption" maxFontSizeMultiplier={1}>{label}</AppText>
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
