import { addDays, packDayOf } from '@gozali/game-engine';
import NetInfo from '@react-native-community/netinfo';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import type { Pack } from '@/features/packs/api';
import { enqueue, flushQueue, hasConnection, isOnline, pendingFeeds } from '@/features/feeds/queue';
import { PHOTO_BUCKET, feedErrorCode, inTime, isFinalRejection, sendFeed, type OutgoingFeed } from '@/features/feeds/send';
import type { ReactionTotal } from '@/features/social/api';
import { notify } from '@/lib/confirm';
import { readableZone } from '@/lib/dates';
import { errorText, reportError } from '@/lib/reportError';
import { requireSupabase } from '@/lib/supabase';
import { serverNow } from '@/lib/serverClock';

export type FeedItem = {
  id: string;
  pack_id: string;
  user_id: string;
  photo_path: string | null;
  caption: string | null;
  day: string;
  is_extra: boolean;
  focus_minutes: number | null;
  created_at: string;
  /** Short-lived signed link; null once the photo was deleted after 30 days. */
  photoUrl: string | null;
  reactions: ReactionTotal[];
};

type CountedFeed = { pack_id: string; user_id: string; day: string };

export const feedsKey = ['feeds'] as const;
export const countedFeedsKey = [...feedsKey, 'counted'] as const;
const PHOTO_LINK_SECONDS = 60 * 60;
export const FEED_PAGE = 30;

/**
 * Counted feeds of the last few days in all of the user's packs. Each pack has its own time
 * zone, so "today" is decided per pack by `fedToday`. They come from `counted_feeds`, not the
 * table: a feed still counts when the user blocked its poster or reports hid its photo.
 */
export function useCountedFeeds() {
  return useQuery({
    queryKey: countedFeedsKey,
    queryFn: async (): Promise<CountedFeed[]> => {
      const supabase = requireSupabase();
      const counted = await supabase.rpc('counted_feeds');
      if (counted.error?.code !== 'PGRST202') {
        if (counted.error) throw counted.error;
        return counted.data;
      }
      // A server without the function yet.
      const since = addDays(serverNow().toISOString().slice(0, 10), -2);
      const { data, error } = await supabase
        .from('feeds')
        .select('pack_id, user_id, day')
        .eq('is_extra', false)
        .gte('day', since);
      if (error) throw error;
      return data;
    },
  });
}

/** Members of the pack who fed on the pack's current day. */
export function fedToday(feeds: CountedFeed[] | undefined, pack: Pick<Pack, 'id' | 'timezone'>, now: Date): Set<string> {
  const today = packDayOf(now, readableZone(pack.timezone));
  return new Set((feeds ?? []).filter((feed) => feed.pack_id === pack.id && feed.day === today).map((feed) => feed.user_id));
}

/**
 * Whether the member's counted feed of the pack's current day waits on this phone to go out. Their
 * part is done, so nothing asks for a second photo. How many fed stays the server's to say.
 */
export function feedWaitsToday(pending: OutgoingFeed[] | undefined, pack: Pick<Pack, 'timezone'>, userId: string | undefined, now: Date): boolean {
  const zone = readableZone(pack.timezone);
  const today = packDayOf(now, zone);
  return (pending ?? []).some((feed) => feed.userId === userId && !feed.extra && packDayOf(new Date(feed.capturedAt), zone) === today);
}

async function fetchReactions(feedIds: string[]): Promise<Map<string, ReactionTotal[]>> {
  const byFeed = new Map<string, ReactionTotal[]>();
  if (feedIds.length === 0) return byFeed;
  const { data, error } = await requireSupabase().rpc('feed_reactions', { feed_ids: feedIds });
  if (error) throw error;
  for (const row of data) {
    const list = byFeed.get(row.feed_id) ?? [];
    list.push({ emoji: row.emoji, total: Number(row.total), mine: row.mine, names: row.names });
    byFeed.set(row.feed_id, list);
  }
  return byFeed;
}

/** Every cached page of every pack feed. */
export const packFeedsKey = [...feedsKey, 'pack'] as const;

/**
 * Fetches one photo's reactions again and puts them into the cached feed pages, without
 * refetching the feed and signing its photo links again.
 */
export async function refreshReactions(queryClient: QueryClient, feedId: string): Promise<void> {
  const fresh = await fetchReactions([feedId]);
  queryClient.setQueriesData<FeedItem[]>({ queryKey: packFeedsKey }, (feeds) =>
    feeds?.map((feed) => (feed.id === feedId ? { ...feed, reactions: fresh.get(feedId) ?? [] } : feed)),
  );
}

/** The pack's feed, newest first, with signed links to the photos and the reactions. */
export function usePackFeed(packId: string, limit = FEED_PAGE) {
  return useQuery({
    queryKey: [...packFeedsKey, packId, limit],
    // The shorter page stays while a longer one loads, or the list would unmount and the reader lose
    // their place. Never another pack's page: a link can change the pack on this same screen.
    placeholderData: (previous, query) => (query?.queryKey[2] === packId ? previous : undefined),
    queryFn: async (): Promise<FeedItem[]> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from('feeds')
        .select('id, pack_id, user_id, photo_path, caption, day, is_extra, focus_minutes, created_at')
        .eq('pack_id', packId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const paths = data.flatMap((feed) => (feed.photo_path ? [feed.photo_path] : []));
      const links = new Map<string, string>();
      const [reactions, signed] = await Promise.all([
        fetchReactions(data.map((feed) => feed.id)),
        paths.length > 0 ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_LINK_SECONDS) : null,
      ]);
      if (signed?.error) throw signed.error;
      for (const item of signed?.data ?? []) if (item.path && item.signedUrl) links.set(item.path, item.signedUrl);
      return data.map((feed) => ({
        ...feed,
        photoUrl: feed.photo_path ? (links.get(feed.photo_path) ?? null) : null,
        reactions: reactions.get(feed.id) ?? [],
      }));
    },
  });
}

export function usePendingFeeds(packId: string) {
  return useQuery({ queryKey: [...feedsKey, 'pending', packId], queryFn: () => pendingFeeds(packId) });
}

/**
 * Sends a feed, or keeps it for a later try when the server didn't turn it down for good. A second
 * counted feed on the same day (for example from another phone) goes out as an extra post instead.
 */
async function sendOrKeep(feed: OutgoingFeed): Promise<'sent' | 'queued'> {
  try {
    await inTime(sendFeed(feed));
    return 'sent';
  } catch (error) {
    if (feedErrorCode(error) === 'already_fed' && !feed.extra) return sendOrKeep({ ...feed, extra: true });
    if (!isFinalRejection(error) && (await enqueue(feed))) return 'queued';
    throw error;
  }
}

/** Sends a feed, or keeps it for later when there is no connection. */
export function useSendFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (feed: OutgoingFeed): Promise<'sent' | 'queued'> => {
      if (!(await isOnline()) && (await enqueue(feed))) return 'queued';
      return sendOrKeep(feed);
    },
    // Not returned: the camera covers the pack, and these reads can die with the same connection.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: feedsKey });
    },
  });
}

/** The error alone doesn't say which of the queue's troubles it was. */
function queueError(what: string, error: unknown): Error {
  return new Error(`${what}: ${errorText(error)}`);
}

/**
 * Sends queued feeds when the app starts, comes back to the foreground, gets online or gets a new
 * token: online during auth-js's wait after a failed refresh there is no session to send with, and
 * nothing else says when there is one. The member was told a queued feed is safe, so they hear
 * about one that was dropped. Getting online also reloads what is on screen: Realtime replays
 * nothing it missed, and nothing else hears about the network (lib/appFocus.ts).
 */
export function useFeedQueue() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const token = useAuth().session?.access_token;
  const flush = useCallback(() => {
    void flushQueue().then(({ handled, dropped, stuck }) => {
      // Not only the feeds: one going out also wakes its sender and takes back their pass. Realtime
      // never sends the second, and may not be back yet for the first.
      if (handled > 0) void queryClient.invalidateQueries();
      if (dropped.length > 0) notify(t('feed.dropped', { count: dropped.length }));
      for (const error of dropped) reportError(queueError('Queued feed dropped', error));
      for (const error of stuck) reportError(queueError('Feed queue stuck', error));
    });
  }, [queryClient, t]);
  useEffect(() => flush(), [flush, token]);
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => state === 'active' && flush());
    let offline = false;
    const network = NetInfo.addEventListener((state) => {
      if (offline && hasConnection(state)) void queryClient.invalidateQueries();
      offline = !hasConnection(state);
      if (state.isConnected) flush();
    });
    return () => {
      appState.remove();
      network();
    };
  }, [flush, queryClient]);
}
