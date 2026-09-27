import type { AchievementKey } from '@gozali/game-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { feedsKey } from '@/features/feeds/api';
import { packsKey } from '@/features/packs/api';
import { isBlockedText } from '@/lib/errors';
import { requireSupabase } from '@/lib/supabase';

export const REACTIONS = [
  { key: 'fire', emoji: '🔥' },
  { key: 'muscle', emoji: '💪' },
  { key: 'laugh', emoji: '😂' },
  { key: 'clap', emoji: '👏' },
  { key: 'suspicious', emoji: '🤨' },
] as const;
export type ReactionKey = (typeof REACTIONS)[number]['key'];

export type ReactionTotal = { emoji: ReactionKey; total: number; mine: boolean; names: string[] };

export type PackEvent = {
  id: string;
  kind: 'joined' | 'hatched' | 'evolved' | 'ran_away' | 'returned' | 'achievement' | 'joker' | 'dressed' | 'named';
  actor_id: string | null;
  payload: Record<string, string | null>;
  created_at: string;
};

export type NameSuggestion = { id: string; user_id: string; name: string; created_at: string };

export type DayResultRow = {
  day: string;
  result: 'success' | 'neutral' | 'fail';
  fed_ids: string[];
  rested_ids: string[];
  joker_ids: string[];
  paused_ids: string[];
  sleeping_ids: string[];
  missed_ids: string[];
};

export type MyStats = {
  totalFeeds: number;
  currentStreak: number;
  bestStreak: number;
  days: { day: string; status: 'fed' | 'rest' | 'missed' }[];
};

const socialKey = ['social'] as const;
const EVENT_PAGE = 30;

export function usePackEvents(packId: string, limit = EVENT_PAGE) {
  return useQuery({
    queryKey: [...feedsKey, 'events', packId, limit],
    queryFn: async (): Promise<PackEvent[]> => {
      const { data, error } = await requireSupabase()
        .from('pack_events')
        .select('id, kind, actor_id, payload, created_at')
        .eq('pack_id', packId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as PackEvent[];
    },
  });
}

export function useReact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ feedId, emoji }: { feedId: string; emoji: ReactionKey | null }) => {
      const { error } = await requireSupabase().rpc('react', { target_feed: feedId, emoji: emoji as ReactionKey });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: feedsKey }),
  });
}

export function useNudge(packId: string) {
  return useMutation({
    mutationFn: async (member: string) => {
      const { error } = await requireSupabase().rpc('nudge', { target: packId, member });
      if (error) throw error;
    },
  });
}

export function useNameSuggestions(packId: string, open: boolean) {
  return useQuery({
    queryKey: [...socialKey, 'names', packId],
    enabled: open,
    queryFn: async (): Promise<NameSuggestion[]> => {
      const { data, error } = await requireSupabase()
        .from('name_suggestions')
        .select('id, user_id, name, created_at')
        .eq('pack_id', packId)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useSuggestName(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await requireSupabase().rpc('suggest_name', { target: packId, suggested: name });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: socialKey }),
  });
}

export function useChooseName(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (suggestion: string) => {
      const { error } = await requireSupabase().rpc('choose_name', { target: packId, suggestion });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: packsKey });
      void queryClient.invalidateQueries({ queryKey: feedsKey });
    },
  });
}

export function useAchievements(packId: string) {
  return useQuery({
    queryKey: [...socialKey, 'achievements', packId],
    queryFn: async (): Promise<Map<AchievementKey, string>> => {
      const { data, error } = await requireSupabase()
        .from('achievements')
        .select('key, unlocked_at')
        .eq('pack_id', packId);
      if (error) throw error;
      return new Map(data.map((row) => [row.key, row.unlocked_at]));
    },
  });
}

export function useDress(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ slot, item }: { slot: 'head' | 'neck' | 'background'; item: string | null }) => {
      const { error } = await requireSupabase().rpc('dress_critter', { target: packId, slot, item: item as string });
      if (error) throw error;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: packsKey });
      void queryClient.invalidateQueries({ queryKey: feedsKey });
    },
  });
}

/** Closed days of one month (YYYY-MM), for the monthly board. */
export function useMonthResults(packId: string, month: string) {
  return useQuery({
    queryKey: [...socialKey, 'month', packId, month],
    queryFn: async (): Promise<DayResultRow[]> => {
      const { data, error } = await requireSupabase()
        .from('day_results')
        .select('day, result, fed_ids, rested_ids, joker_ids, paused_ids, sleeping_ids, missed_ids')
        .eq('pack_id', packId)
        .gte('day', `${month}-01`)
        .lte('day', `${month}-31`)
        .order('day');
      if (error) throw error;
      return data;
    },
  });
}

export function useMyStats() {
  return useQuery({
    queryKey: [...socialKey, 'me'],
    queryFn: async (): Promise<MyStats> => {
      const { data, error } = await requireSupabase().rpc('my_stats');
      if (error) throw error;
      return data as MyStats;
    },
  });
}

export function useReport() {
  return useMutation({
    mutationFn: async ({ feedId, reporterId, reason }: { feedId: string; reporterId: string; reason: string | null }) => {
      const { error } = await requireSupabase()
        .from('reports')
        .upsert({ feed_id: feedId, reporter_id: reporterId, reason }, { onConflict: 'feed_id,reporter_id', ignoreDuplicates: true });
      if (error) throw error;
    },
  });
}

export function useBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ blockerId, blockedId }: { blockerId: string; blockedId: string }) => {
      const { error } = await requireSupabase()
        .from('blocks')
        .upsert({ blocker_id: blockerId, blocked_id: blockedId }, { ignoreDuplicates: true });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: feedsKey }),
  });
}

export function socialErrorKey(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  for (const code of [
    'already_nudged',
    'already_fed',
    'not_counted_today',
    'cannot_nudge',
    'too_many_suggestions',
    'name_not_open',
    'item_locked',
    'critter_not_here',
  ] as const) {
    if (message.includes(code)) return `social.errors.${code}` as const;
  }
  if (isBlockedText(error)) return 'errors.textNotAllowed' as const;
  return 'errors.saveFailed' as const;
}
