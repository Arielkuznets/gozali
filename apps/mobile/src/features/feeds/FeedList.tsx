import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { FeedItem } from '@/features/feeds/api';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function when(createdAt: string, now: Date): string {
  const date = new Date(createdAt);
  const time = timeFormat.format(date);
  return date.toDateString() === now.toDateString() ? time : `${dayFormat.format(date)}, ${time}`;
}

type Props = {
  feeds: FeedItem[];
  names: Map<string, string | null>;
  emoji: string;
  now: Date;
};

/** The pack's photos, newest first (spec section 7). Reactions and reports come with the social phase. */
export function FeedList({ feeds, names, emoji, now }: Props) {
  const { t } = useTranslation();
  if (feeds.length === 0) {
    return <AppText style={styles.empty}>{t('pack.feedEmpty')}</AppText>;
  }
  return (
    <View style={styles.list}>
      {feeds.map((feed) => (
        <View key={feed.id} style={styles.card}>
          <View style={styles.meta}>
            <AppText style={styles.name}>{names.get(feed.user_id) ?? '…'}</AppText>
            <AppText variant="caption">
              {when(feed.created_at, now)}
              {feed.is_extra ? ` · ${t('pack.extra')}` : ''}
            </AppText>
          </View>
          {feed.photoUrl ? (
            <Image
              source={{ uri: feed.photoUrl, cacheKey: feed.id }}
              style={styles.photo}
              contentFit="cover"
              transition={150}
              accessibilityLabel={feed.caption ?? t('feed.photoLabel')}
            />
          ) : (
            <View style={[styles.photo, styles.noPhoto]} />
          )}
          {feed.focus_minutes !== null && (
            <AppText style={styles.focus}>{t('feed.focusChip', { minutes: feed.focus_minutes, emoji })}</AppText>
          )}
          {feed.caption !== null && <AppText>{feed.caption}</AppText>}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  empty: { color: colors.inkMuted, textAlign: 'center', paddingVertical: spacing.lg },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  name: { fontFamily: fonts.bodyMedium },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.md, backgroundColor: colors.border },
  noPhoto: { aspectRatio: 4 },
  focus: { fontFamily: fonts.bodyMedium, color: colors.inkMuted },
});
