import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { daysKey } from '@/features/days/api';
import { feedsKey } from '@/features/feeds/api';
import { packsKey } from '@/features/packs/api';
import { supabase } from '@/lib/supabase';

/**
 * Refetches when a pack's critter, members, feeds or day passes change on the server. Row level security
 * applies to Realtime too, so a user only hears about packs they belong to. Without an id the
 * subscription covers every pack of the user (the home screen).
 */
export function usePackRealtime(packId?: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const filter = packId ? `pack_id=eq.${packId}` : undefined;
    const refetchPacks = () => void queryClient.invalidateQueries({ queryKey: packsKey });
    const refetchFeeds = () => void queryClient.invalidateQueries({ queryKey: feedsKey });
    const refetchDays = () => void queryClient.invalidateQueries({ queryKey: daysKey });
    const channel = client
      .channel(`packs-live:${packId ?? 'mine'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'critters', filter }, refetchPacks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pack_members', filter }, refetchPacks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feeds', filter }, refetchFeeds)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_passes', filter }, refetchDays)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [packId, queryClient]);
}
