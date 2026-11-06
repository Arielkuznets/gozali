import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

import { daysKey } from '@/features/days/api';
import { feedsKey, refreshReactions } from '@/features/feeds/api';
import { packsKey } from '@/features/packs/api';
import { supabase } from '@/lib/supabase';

const REJOIN_READ_GAP_MS = 30_000;

/**
 * Realtime replays nothing, so each join runs `read` for what the socket missed, apart from a first
 * join that works at once. After a try that failed it has missed as much as any rejoin: the socket
 * may have been down since the app opened. A socket that keeps dropping reads once in each gap, and
 * at the end of a gap in which it came back, so the last rejoin always gets its read.
 */
function readAfterRejoins(read: () => void) {
  let tried = false;
  let missed = false;
  let gap: ReturnType<typeof setTimeout> | undefined;
  const readNow = () => {
    missed = false;
    read();
    gap = setTimeout(() => {
      gap = undefined;
      if (missed) readNow();
    }, REJOIN_READ_GAP_MS);
  };
  return {
    onStatus: (status: string) => {
      if (status === 'SUBSCRIBED' && tried) {
        if (gap) missed = true;
        else readNow();
      }
      tried = true;
    },
    stop: () => clearTimeout(gap),
  };
}

/**
 * Refetches when a pack's critter, members, feeds, events, reactions, day passes or bought items
 * are added or change on the server. Row level security applies to Realtime too, so a user only
 * hears about packs they belong to. Deletes aren't published (decision D23): something taken back
 * shows on the next refetch. Without an id the subscription covers every pack of the user (the
 * home screen), which is under every other screen, so that one alone reads what a dropped socket
 * missed.
 */
export function usePackRealtime(packId?: string) {
  const queryClient = useQueryClient();
  // Every screen gets its own channel: supabase-js hands back an existing channel with the same
  // name, and a second screen adding listeners to it after it started would throw (the pet
  // profile opens on top of the pack screen, both listening to the same pack).
  const instance = useId();
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const filter = packId ? `pack_id=eq.${packId}` : undefined;
    const refetchPacks = () => void queryClient.invalidateQueries({ queryKey: packsKey });
    const refetchFeeds = () => void queryClient.invalidateQueries({ queryKey: feedsKey });
    const refetchDays = () => void queryClient.invalidateQueries({ queryKey: daysKey });
    const refetchSocial = () => void queryClient.invalidateQueries({ queryKey: ['social'] });
    // A reaction changes one photo's totals; only those are fetched again, not the whole feed.
    const refetchReactions = (payload: { new: { feed_id?: string } }) => {
      const feedId = payload.new.feed_id;
      if (feedId) void refreshReactions(queryClient, feedId).catch(refetchFeeds);
      else refetchFeeds();
    };
    const rejoins = readAfterRejoins(() => {
      refetchPacks();
      refetchFeeds();
      refetchDays();
      refetchSocial();
    });
    let leaving = false;
    const channel = client
      .channel(`packs-live:${packId ?? 'mine'}:${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'critters', filter }, refetchPacks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pack_members', filter }, refetchPacks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feeds', filter }, refetchFeeds)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pack_events', filter }, refetchFeeds)
      // Reactions have no pack column; the policy limits them to the user's packs.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, refetchReactions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'name_suggestions', filter }, refetchSocial)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pack_items', filter }, refetchSocial)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_passes', filter }, refetchDays);
    // A join takes the token known when it is sent, and while it waits for its answer no newer token
    // reaches it. A start on an expired token is still refreshing it, so the join waits for that
    // instead of staying anonymous.
    void client.realtime
      .setAuth()
      .catch(() => undefined)
      .then(() => {
        if (!leaving) channel.subscribe(packId ? undefined : rejoins.onStatus);
      });
    return () => {
      leaving = true;
      rejoins.stop();
      void client.removeChannel(channel);
    };
  }, [packId, queryClient, instance]);
}
