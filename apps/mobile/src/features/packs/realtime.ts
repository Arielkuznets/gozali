import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

import { daysKey } from '@/features/days/api';
import { feedsKey, refreshReactions } from '@/features/feeds/api';
import { packsKey } from '@/features/packs/api';
import { supabase } from '@/lib/supabase';

/**
 * Refetches when a pack's critter, members, feeds, events, reactions, day passes or bought items change on
 * the server. Row level security
 * applies to Realtime too, so a user only hears about packs they belong to. Without an id the
 * subscription covers every pack of the user (the home screen).
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
    // On a delete the new row is empty and the old one still has its key.
    const refetchReactions = (payload: { new: { feed_id?: string }; old: { feed_id?: string } }) => {
      const feedId = payload.new.feed_id ?? payload.old.feed_id;
      if (feedId) void refreshReactions(queryClient, feedId).catch(refetchFeeds);
      else refetchFeeds();
    };
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_passes', filter }, refetchDays)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [packId, queryClient, instance]);
}
