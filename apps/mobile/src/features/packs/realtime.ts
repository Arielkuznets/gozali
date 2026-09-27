import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { packsKey } from '@/features/packs/api';
import { supabase } from '@/lib/supabase';

/**
 * Refetches packs when their critter or members change on the server. Row level security
 * applies to Realtime too, so a user only hears about packs they belong to. Without an id
 * the subscription covers every pack of the user (the home screen).
 */
export function usePackRealtime(packId?: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const filter = packId ? `pack_id=eq.${packId}` : undefined;
    const refetch = () => void queryClient.invalidateQueries({ queryKey: packsKey });
    const channel = client
      .channel(`packs-live:${packId ?? 'mine'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'critters', filter }, refetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pack_members', filter }, refetch)
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [packId, queryClient]);
}
