import type { CritterRow } from '@gozali/critter-art';
import type { AchievementKey } from '@gozali/game-engine';
import { useQuery } from '@tanstack/react-query';

import { PHOTO_BUCKET } from '@/features/feeds/send';
import { requireSupabase } from '@/lib/supabase';

export type RecapStats = {
  weekStart: string;
  weekEnd: string;
  days: number;
  successDays: number;
  healthStart: number;
  healthEnd: number;
  topMembers: string[];
  topFeeds: number;
  achievements: AchievementKey[];
  critter: CritterRow & { name: string | null; streak: number };
};

export type Recap = { week_start: string; stats: RecapStats; feed_ids: string[] };

export type RecapPhoto = { id: string; userId: string; url: string };

const PHOTO_LINK_SECONDS = 60 * 60;

export function useRecaps(packId: string) {
  return useQuery({
    queryKey: ['social', 'recaps', packId],
    queryFn: async (): Promise<Recap[]> => {
      const { data, error } = await requireSupabase()
        .from('weekly_recaps')
        .select('week_start, stats, feed_ids')
        .eq('pack_id', packId)
        .order('week_start', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as unknown as Recap[];
    },
  });
}

/** The collage photos a member may see (hidden and blocked ones drop out), with signed links. */
export function useRecapPhotos(recap: Recap | undefined) {
  return useQuery({
    queryKey: ['feeds', 'recap-photos', recap?.week_start, recap?.feed_ids.join()],
    enabled: recap !== undefined && recap.feed_ids.length > 0,
    staleTime: (PHOTO_LINK_SECONDS / 2) * 1000,
    queryFn: async (): Promise<RecapPhoto[]> => {
      const supabase = requireSupabase();
      const { data, error } = await supabase.from('feeds').select('id, user_id, photo_path').in('id', recap!.feed_ids);
      if (error) throw error;
      const withPhotos = data.filter((feed) => feed.photo_path !== null);
      if (withPhotos.length === 0) return [];
      const signed = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrls(withPhotos.map((feed) => feed.photo_path!), PHOTO_LINK_SECONDS);
      if (signed.error) throw signed.error;
      const links = new Map(signed.data.map((item) => [item.path, item.signedUrl]));
      const order = new Map(recap!.feed_ids.map((id, index) => [id, index]));
      return withPhotos
        .map((feed) => ({ id: feed.id, userId: feed.user_id, url: links.get(feed.photo_path) ?? '' }))
        .filter((photo) => photo.url !== '')
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
  });
}
