import { packDayOf } from '@gozali/game-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Pack } from '@/features/packs/api';
import { requireSupabase } from '@/lib/supabase';

/** my_day_status: what the caller can do today in a pack. */
export type DayStatus = {
  day: string;
  restDaysPerWeek: number;
  restDaysLeft: number;
  jokerAvailable: boolean;
  passToday: 'joker' | 'rest' | null;
  fedToday: boolean;
  pause: { startsOn: string; endsOn: string } | null;
  pauseAvailableFrom: string | null;
};

export type TodayPasses = {
  /** Members with a joker or a declared rest today. */
  passes: Map<string, 'joker' | 'rest'>;
  /** Members on a pause that covers today. */
  paused: Set<string>;
};

export const daysKey = ['days'] as const;
export const PAUSE_LENGTHS = [3, 7, 14, 30, 60] as const;

export function useDayStatus(packId: string) {
  return useQuery({
    queryKey: [...daysKey, 'status', packId],
    queryFn: async (): Promise<DayStatus> => {
      const { data, error } = await requireSupabase().rpc('my_day_status', { target: packId });
      if (error) throw error;
      return data as DayStatus;
    },
  });
}

/** Today's passes and pauses of every member, for the circles on the pack screen. */
export function useTodayPasses(pack: Pick<Pack, 'id' | 'timezone'> | undefined, now: Date) {
  const today = pack ? packDayOf(now, pack.timezone) : '';
  return useQuery({
    queryKey: [...daysKey, 'passes', pack?.id, today],
    enabled: pack !== undefined,
    queryFn: async (): Promise<TodayPasses> => {
      const supabase = requireSupabase();
      const [passes, pauses] = await Promise.all([
        supabase.from('day_passes').select('user_id, kind').eq('pack_id', pack!.id).eq('day', today),
        supabase.from('pauses').select('user_id').eq('pack_id', pack!.id).lte('starts_on', today).gte('ends_on', today),
      ]);
      if (passes.error) throw passes.error;
      if (pauses.error) throw pauses.error;
      return {
        passes: new Map(passes.data.map((row) => [row.user_id, row.kind])),
        paused: new Set(pauses.data.map((row) => row.user_id)),
      };
    },
  });
}

function useDayAction<T>(action: (packId: string, value: T) => PromiseLike<{ error: unknown }>, packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: T) => {
      const { error } = await action(packId, value);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: daysKey }),
  });
}

export function useDayPass(packId: string) {
  return useDayAction<'joker' | 'rest'>(
    (target, pass) => requireSupabase().rpc('use_day_pass', { target, pass }),
    packId,
  );
}

export function useCancelDayPass(packId: string) {
  return useDayAction<void>((target) => requireSupabase().rpc('cancel_day_pass', { target }), packId);
}

export function useStartPause(packId: string) {
  return useDayAction<number>((target, days) => requireSupabase().rpc('start_pause', { target, days }), packId);
}

export function useEndPause(packId: string) {
  return useDayAction<void>((target) => requireSupabase().rpc('end_pause', { target }), packId);
}

/** Maps the server's error codes to translation keys. */
export function dayErrorKey(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  // Longer codes first: 'already_paused' contains 'paused'.
  for (const code of [
    'already_fed',
    'already_paused',
    'already_passed',
    'paused',
    'no_rest_days_left',
    'joker_used',
    'pause_cooldown',
    'pause_too_short',
  ] as const) {
    if (message.includes(code)) return `days.errors.${code}` as const;
  }
  return 'errors.saveFailed' as const;
}
