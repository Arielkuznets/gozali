import { ACHIEVEMENTS, type AchievementKey } from '@gozali/game-engine';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { FeedItem } from '@/features/feeds/api';
import { PhotoViewer, type ViewedPhoto } from '@/features/feeds/PhotoViewer';
import { SignedPhoto } from '@/features/feeds/SignedPhoto';
import { REACTIONS, type PackEvent, type ReactionKey } from '@/features/social/api';
import { formatMoment } from '@/lib/dates';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

type Props = {
  feeds: FeedItem[];
  events: PackEvent[];
  /** The items the pack bought, once read. */
  bought?: Set<string>;
  names: Map<string, string | null>;
  critterName: string;
  emoji: string;
  /** The current day as `Date.toDateString` gives it: a clock tick mustn't reach the rows. */
  today: string;
  /** Someone in the pack fed today, whether or not their post is in `feeds`. */
  someoneFed: boolean;
  userId: string | undefined;
  onReact: (feed: FeedItem, emoji: ReactionKey | null) => void;
  onMore: (feed: FeedItem) => void;
};

/**
 * The pack feed (spec section 7): photos and system events, newest first. Photos carry the
 * reactions and a menu to report the photo or block the member who posted it. A tap on a photo
 * opens it on the whole screen.
 */
export function FeedList({ feeds, events, bought, names, critterName, emoji, today, someoneFed, userId, onReact, onMore }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<ViewedPhoto | null>(null);
  const entries = [
    ...feeds.map((feed) => ({ kind: 'photo' as const, at: feed.created_at, feed })),
    ...events.map((event) => ({ kind: 'event' as const, at: event.created_at, event })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (entries.length === 0) {
    // A block or a report takes a post out of this list and leaves its member fed on the same screen.
    return <AppText style={styles.empty}>{t(someoneFed ? 'pack.feedOutOfSight' : 'pack.feedEmpty')}</AppText>;
  }
  const nameOf = (id: string) => names.get(id) ?? '…';
  const onOpen = (feed: FeedItem) =>
    setOpen({ id: feed.id, userId: feed.user_id, url: feed.photoUrl, caption: feed.caption, name: nameOf(feed.user_id) });

  return (
    <View style={styles.list}>
      {entries.map((entry) =>
        entry.kind === 'event' ? (
          <AppText key={entry.event.id} variant="caption" style={styles.event}>
            {eventText(entry.event, t, nameOf, critterName, bought)}
          </AppText>
        ) : (
          <PhotoCard
            key={entry.feed.id}
            feed={entry.feed}
            name={nameOf(entry.feed.user_id)}
            emoji={emoji}
            today={today}
            own={entry.feed.user_id === userId}
            onReact={onReact}
            onMore={onMore}
            onOpen={onOpen}
          />
        ),
      )}
      <PhotoViewer photo={open} onClose={() => setOpen(null)} />
    </View>
  );
}

type Translate = ReturnType<typeof useTranslation>['t'];

function eventText(event: PackEvent, t: Translate, nameOf: (id: string) => string, critter: string, bought: Set<string> | undefined): string {
  // A deleted account leaves its lines with no member; '…' is for a name still on its way.
  const name = event.actor_id === null ? t('events.someone') : nameOf(event.actor_id);
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
      const title = t(`achievements.${key}.title`);
      // The shop doesn't sell what the pack owns, so a bought item was there before the achievement.
      if (bought?.has(item) !== false) return t('events.achievementOwned', { critter, title });
      return t('events.achievement', { critter, title, item: t(`items.${item as 'scarf'}`) });
    }
    case 'joker':
      return t('events.joker', { name });
    case 'dressed':
      return event.payload.item
        ? t('events.dressed', { name, critter, item: t(`items.${event.payload.item as 'scarf'}`) })
        : t('events.undressed', { name, critter });
    case 'named':
      return t('events.named', { name, critter: event.payload.name ?? critter });
    case 'bought':
      return t('events.bought', { name, critter, item: t(`items.${event.payload.item as 'scarf'}`) });
  }
}

type CardProps = {
  feed: FeedItem;
  name: string;
  emoji: string;
  today: string;
  own: boolean;
  onReact: (feed: FeedItem, emoji: ReactionKey | null) => void;
  onMore: (feed: FeedItem) => void;
  onOpen: (feed: FeedItem) => void;
};

const PhotoCard = memo(function PhotoCard({ feed, name, emoji, today, own, onReact, onMore, onOpen }: CardProps) {
  const { t } = useTranslation();
  const totals = new Map(feed.reactions.map((reaction) => [reaction.emoji, reaction]));
  const reactedBy = feed.reactions.filter((reaction) => reaction.emoji !== 'suspicious').flatMap((reaction) => reaction.names);
  return (
    <View style={styles.card}>
      <View style={styles.meta}>
        <AppText style={styles.name} numberOfLines={1}>
          {name}
        </AppText>
        <View style={styles.metaRight}>
          <AppText variant="caption" style={styles.time}>
            {formatMoment(feed.created_at, today)}
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
          <SignedPhoto
            id={feed.id}
            url={feed.photoUrl}
            style={styles.photo}
            contentFit="cover"
            transition={150}
            accessibilityLabel={feed.caption ?? t('feed.photoBy', { name })}
          />
        </Pressable>
      ) : feed.photo_path === null ? (
        <View style={styles.noPhoto}>
          <AppText variant="caption" style={styles.noPhotoText}>
            {t('feed.photoGone')}
          </AppText>
        </View>
      ) : (
        <View style={styles.photo} />
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
});

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
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  // ⋯ is the only way to report a photo, so it stays on the card: a long name gives way to it. At
  // the largest text sizes the time wraps, and the quarter of the row left over keeps a short name.
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '75%' },
  name: { fontFamily: fonts.bodyMedium, flexShrink: 1 },
  time: { flexShrink: 1 },
  more: { fontSize: 20, lineHeight: 22, color: colors.inkMuted },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: radii.md, backgroundColor: colors.border },
  noPhoto: { padding: spacing.lg, borderRadius: radii.md, backgroundColor: colors.background },
  noPhotoText: { textAlign: 'center' },
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
