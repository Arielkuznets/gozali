import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCalendars } from 'expo-localization';

import type { Category, CritterStage, CritterStatus, Species, WeekStart } from '@/features/packs/constants';
import { isBlockedText } from '@/lib/errors';
import { requireSupabase } from '@/lib/supabase';

export type PackMember = {
  user_id: string;
  role: 'admin' | 'member';
  status: 'active' | 'sleeping' | 'left';
  joined_at: string;
  profiles: { display_name: string | null; avatar_path: string | null } | null;
};

export type PackCritter = {
  species: Species;
  name: string | null;
  health: number;
  xp: number;
  stage: CritterStage;
  status: CritterStatus;
  streak: number;
  marks: string[];
  outfit: unknown;
};

export type Pack = {
  id: string;
  name: string;
  category: Category;
  custom_habit: string | null;
  rest_days_per_week: number;
  week_start: WeekStart;
  invite_code: string;
  pending_rest_days_per_week: number | null;
  pending_week_start: WeekStart | null;
  pending_from: string | null;
  timezone: string;
  critters: PackCritter | null;
  pack_members: PackMember[];
};

export type PackPreview = {
  pack_id: string;
  pack_name: string;
  category: Category;
  custom_habit: string | null;
  critter: PackCritter;
  member_count: number;
  member_names: string[];
  is_full: boolean;
  already_member: boolean;
};

const PACK_FIELDS = `
  id, name, category, custom_habit, rest_days_per_week, week_start, timezone, invite_code,
  pending_rest_days_per_week, pending_week_start, pending_from,
  critters ( species, name, health, xp, stage, status, streak, marks, outfit ),
  pack_members ( user_id, role, status, joined_at, profiles ( display_name, avatar_path ) )
`;

export const packsKey = ['packs'] as const;
const packKey = (id: string) => ['packs', id] as const;

/** Members who still belong to the pack, oldest first. */
export function currentMembers(pack: Pack): PackMember[] {
  return pack.pack_members
    .filter((member) => member.status !== 'left')
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at));
}

/** Members who count today, as in "3/5 fed" here and on the widget: not asleep and not paused. */
export function countedToday(pack: Pack, paused: ReadonlySet<string>): PackMember[] {
  return currentMembers(pack).filter((member) => member.status === 'active' && !paused.has(member.user_id));
}

export function useMyPacks() {
  return useQuery({
    queryKey: packsKey,
    queryFn: async (): Promise<Pack[]> => {
      // Row level security returns only the caller's packs.
      const { data, error } = await requireSupabase().from('packs').select(PACK_FIELDS).order('created_at');
      if (error) throw error;
      return data as unknown as Pack[];
    },
  });
}

export function usePack(id: string) {
  return useQuery({
    queryKey: packKey(id),
    // Null once the pack isn't visible (left or removed), so screens can say so instead of
    // keeping the last copy on screen.
    queryFn: async (): Promise<Pack | null> => {
      const { data, error } = await requireSupabase().from('packs').select(PACK_FIELDS).eq('id', id).maybeSingle();
      if (error) throw error;
      return data as unknown as Pack | null;
    },
  });
}

export function usePackPreview(code: string) {
  return useQuery({
    queryKey: ['pack-preview', code],
    enabled: code.length === 8,
    queryFn: async (): Promise<PackPreview | null> => {
      const { data, error } = await requireSupabase().rpc('pack_preview', { code });
      if (error) throw error;
      const rows = data as PackPreview[];
      return rows[0] ?? null;
    },
  });
}

export type NewPack = {
  name: string;
  category: Category;
  customHabit: string | null;
  restDays: number;
  species: Species;
};

export function useCreatePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pack: NewPack): Promise<string> => {
      const { data, error } = await requireSupabase().rpc('create_pack', {
        pack_name: pack.name,
        habit: pack.category,
        habit_text: pack.customHabit ?? undefined,
        rest_days: pack.restDays,
        species: pack.species,
        time_zone: getCalendars()[0]?.timeZone ?? 'UTC',
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packsKey }),
  });
}

export function useJoinPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await requireSupabase().rpc('join_pack', { code });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packsKey }),
  });
}

export function useLeavePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (packId: string) => {
      const { error } = await requireSupabase().rpc('leave_pack', { target: packId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packsKey }),
  });
}

export function useUpdatePack(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: { name: string; restDays: number; weekStart: WeekStart }) => {
      const { error } = await requireSupabase().rpc('update_pack', {
        target: packId,
        pack_name: settings.name,
        rest_days: settings.restDays,
        starts_on: settings.weekStart,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packsKey }),
  });
}

export function useRemoveMember(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await requireSupabase().rpc('remove_member', { target: packId, member: userId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: packsKey }),
  });
}

/** Maps the server's error codes to translation keys. */
export function packErrorKey(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('pack_limit_reached')) return 'packs.errors.limitReached' as const;
  if (message.includes('pack_full')) return 'packs.errors.full' as const;
  if (message.includes('invite_not_found')) return 'packs.errors.notFound' as const;
  if (message.includes('admin_only')) return 'packs.errors.adminOnly' as const;
  if (isBlockedText(error)) return 'errors.textNotAllowed' as const;
  return 'errors.saveFailed' as const;
}
