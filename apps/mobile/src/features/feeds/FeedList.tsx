import { ACHIEVEMENTS, type AchievementKey } from '@gozali/game-engine';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { FeedItem } from '@/features/feeds/api';
import { PhotoViewer, type ViewedPhoto } from '@/features/feeds/PhotoViewer';
import { REACTIONS, type PackEvent, type ReactionKey } from '@/features/social/api';
import { formatMoment } from '@/lib/dates';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  feeds: FeedItem[];
  events: PackEvent[];
  names: Map<string, string | null>;
  critterName: string;
  emoji: string;
  now: Date;
  userId: string | undefined;
  onReact: (feed: FeedItem, emoji: ReactionKey | null) => void;
  onMore: (feed: FeedItem) => void;
};

/**
 * The pack feed (spec section 7): photos and system events, newest first. Photos carry the
 * reactions and a menu to report the photo or block the member who posted it. A tap on a photo
 * opens it on the whole screen.
 */
export function FeedList({ feeds, events, names, critterName, emoji, now, userId, onReact, onMore }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ViewedPhoto | null>(null);
  const entries = [
    ...feeds.map((feed) => ({ kind: 'photo' as const, at: feed.created_at, feed })),
    ...events.map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (entries.length === 0) {
    return <AppText style={styles.empty}>{t('pack.feedEmpty')}</AppText>;
  }
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? '…') : '…');

  return (
    <View style={styles.list}>
      {entries.map((entry) =>
        entry.kind === 'event' ? (
          <AppText key={entry.event.id} variant="caption" style={styles.event}>
            {eventText(entry.event, t, nameOf, critterName)}
          </AppText>
        ) : (
          <PhotoCard
            key={entry.feed.id}
            feed={entry.feed}
            name={nameOf(entry.feed.user_id)}
            emoji={emoji}
            now={now}
            own={entry.feed.user_id === userId}
            onReact={onReact}
            onMore={onMore}
            onOpen={(feed) =>
              setOpen({ id: feed.id, url: feed.photoUrl, caption: feed.caption, name: nameOf(feed.user_id) })
            }
          />
        ),
      )}
      <PhotoViewer photo={open} onClose={() => setOpen(null)} />
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function eventText(event: PackEvent, t: Translate, nameOf: (id: string | null) => string, critter: string): string {
  const name = nameOf(event.actor_id);
  switch (event.kind) {
    case 'joined':
      return t('events.joined', { name });
    case 'hatched':
      return t('events.hatched', { critter });
    case 'evolved':
      return t('events.evolved', { critter, stage: t(`critter.stages.${event.payload.to as 'kid'}`) });
    case 'ran_away':
      return t('events.ran_away', { critter });
    case 'returned':
      return t('events.returned', { critter });
    case 'achievement': {
      const key = event.payload.key as AchievementKey;
      const item = ACHIEVEMENTS.find((achievement) => achievement.key === key)?.item.key ?? 'scarf';
      return t('events.achievement', {
        critter,
        title: t(`achievements.${key}.title`),
        item: t(`items.${item as 'scarf'}`),
      });
    }
    case 'joker':
      return t('events.joker', { name });
    case 'dressed':
      return event.payload.item
        ? t('events.dressed', { name, critter, item: t(`items.${event.payload.item as 'scarf'}`) })
        : t('events.undressed', { name, critter });
    case 'named':
      return t('events.named', { name, critter: event.payload.name ?? critter });
  }
}

type CardProps = {
  feed: FeedItem;
  name: string;
  emoji: string;
  now: Date;
  own: boolean;
  onReact: (feed: FeedItem, emoji: ReactionKey | null) => void;
  onMore: (feed: FeedItem) => void;
  onOpen: (feed: FeedItem) => void;
};

function PhotoCard({ feed, name, emoji, now, own, onReact, onMore, onOpen }: CardProps) {
  const { t } = useTranslation();
  const totals = new Map(feed.reactions.map((reaction) => [reaction.emoji, reaction]));
  const reactedBy = feed.reactions.filter((reaction) => reaction.emoji !== 'suspicious').flatMap((reaction) => reaction.names);
  return (
    <View style={styles.card}>
      <View style={styles.meta}>
        <AppText style={styles.name}>{name}</AppText>
        <View style={styles.metaRight}>
          <AppText variant="caption">
            {formatMoment(feed.created_at, now)}
            {feed.is_extra ? ` · ${t('pack.extra')}` : ''}
          </AppText>
          {!own && (
            <Pressable accessibilityRole="button" accessibilityLabel={t('social.more')} onPress={() => onMore(feed)} hitSlop={12}>
              <AppText style={styles.more}>⋯</AppText>
            </Pressable>
          )}
        </View>
      </View>
      {feed.photoUrl ? (
        <Pressable accessibilityRole="imagebutton" accessibilityHint={t('feed.openPhoto')} onPress={() => onOpen(feed)}>
          <Image
            source={{ uri: feed.photoUrl, cacheKey: feed.id }}
            style={styles.photo}
            contentFit="cover"
            transition={150}
            accessibilityLabel={feed.caption ?? t('feed.photoBy', { name })}
          />
        </Pressable>
      ) : (
        <View style={[styles.photo, styles.noPhoto]} />
      )}
      {feed.focus_minutes !== null && (
        <AppText style={styles.focus}>{t('feed.focusChip', { minutes: feed.focus_minutes, emoji })}</AppText>
      )}
      {feed.caption !== null && <AppText>{feed.caption}</AppText>}
      <View style={styles.reactions}>
        {REACTIONS.map((reaction) => {
          const total = totals.get(reaction.key);
          const mine = total?.mine ?? false;
          return (
            <Pressable
              key={reaction.key}
              accessibilityRole="button"
              accessibilityLabel={t('social.react', { emoji: reaction.emoji })}
              accessibilityState={{ selected: mine }}
              onPress={() => onReact(feed, mine ? null : reaction.key)}
              style={[styles.reaction, mine && styles.reactionMine]}>
              <AppText>{reaction.emoji}</AppText>
              {total && <AppText variant="caption">{total.total}</AppText>}
            </Pressable>
          );
        })}
      </View>
      {reactedBy.length > 0 && (
        <AppText variant="caption" numberOfLines={1}>
          {t('social.reactedBy', { names: reactedBy.join(', ') })}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  empty: { color: colors.inkMuted, textAlign: 'center', paddingVertical: spacing.lg },
  event: { textAlign: 'center', paddingHorizontal: spacing.md },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontFamily: fonts.bodyMedium },
  more: { fontSize: 20, lineHeight: 22, color: colors.inkMuted },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.md, backgroundColor: colors.border },
  noPhoto: { aspectRatio: 4 },
  focus: { fontFamily: fonts.bodyMedium, color: colors.inkMuted },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  reaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reactionMine: { borderColor: colors.accent, backgroundColor: '#FCE9E2' },
});
