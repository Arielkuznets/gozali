import { addDays, packDayOf } from '@gozali/game-engine';
import NetInfo from '@react-native-community/netinfo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { Pack } from '@/features/packs/api';
import { enqueue, flushQueue, isOnline, pendingFeeds } from '@/features/feeds/queue';
import { PHOTO_BUCKET, feedErrorCode, isFinalRejection, sendFeed, type OutgoingFeed } from '@/features/feeds/send';
import type { ReactionTotal } from '@/features/social/api';
import { requireSupabase } from '@/lib/supabase';

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
const PHOTO_LINK_SECONDS = 60 * 60;
const FEED_PAGE = 30;

/**
 * Counted feeds of the last few days in all of the user's packs. Each pack has its own time
 * zone, so "today" is decided per pack by `fedToday`.
 */
export function useCountedFeeds() {
  return useQuery({
    queryKey: [...feedsKey, 'counted'],
    queryFn: async (): Promise<CountedFeed[]> => {
      const since = addDays(new Date().toISOString().slice(0, 10), -2);
      const { data, error } = await requireSupabase()
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
  const today = packDayOf(now, pack.timezone);
  return new Set((feeds ?? []).filter((feed) => feed.pack_id === pack.id && feed.day === today).map((feed) => feed.user_id));
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

/** The pack's feed, newest first, with signed links to the photos and the reactions. */
export function usePackFeed(packId: string) {
  return useQuery({
    queryKey: [...feedsKey, 'pack', packId],
    // Links last an hour; refetch well before they run out.
    staleTime: (PHOTO_LINK_SECONDS / 2) * 1000,
    queryFn: async (): Promise<FeedItem[]> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase
        .from('feeds')
        .select('id, pack_id, user_id, photo_path, caption, day, is_extra, focus_minutes, created_at')
        .eq('pack_id', packId)
        .order('created_at', { ascending: false })
        .limit(FEED_PAGE);
      if (error) throw error;
      const paths = data.flatMap((feed) => (feed.photo_path ? [feed.photo_path] : []));
      const links = new Map<string, string>();
      const reactions = await fetchReactions(data.map((feed) => feed.id));
      if (paths.length > 0) {
        const signed = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_LINK_SECONDS);
        if (signed.error) throw signed.error;
        for (const item of signed.data) if (item.path && item.signedUrl) links.set(item.path, item.signedUrl);
      }
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
 * Sends a feed, or keeps it for later when there is no connection. A second counted feed on
 * the same day (for example from another phone) goes out as an extra post instead.
 */
export function useSendFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (feed: OutgoingFeed): Promise<'sent' | 'queued'> => {
      if (!(await isOnline()) && (await enqueue(feed))) return 'queued';
      try {
        await sendFeed(feed);
        return 'sent';
      } catch (error) {
        if (feedErrorCode(error) === 'already_fed') {
          await sendFeed({ ...feed, extra: true });
          return 'sent';
        }
        if (!isFinalRejection(error) && (await enqueue(feed))) return 'queued';
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: feedsKey }),
  });
}

/** Sends queued feeds when the app starts, comes back to the foreground or gets online. */
export function useFeedQueue() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const flush = () => {
      void flushQueue().then((handled) => {
        if (handled > 0) void queryClient.invalidateQueries({ queryKey: feedsKey });
      });
    };
    flush();
    const appState = AppState.addEventListener('change', (state) => state === 'active' && flush());
    const network = NetInfo.addEventListener((state) => state.isConnected && flush());
    return () => {
      appState.remove();
      network();
    };
  }, [queryClient]);
}
