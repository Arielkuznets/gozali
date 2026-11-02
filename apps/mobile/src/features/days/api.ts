import { packDayOf, type DayInput } from '@gozali/game-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { packsKey, usePack, type Pack, type PackMember } from '@/features/packs/api';
import { readableZone } from '@/lib/dates';
import { isBlockedText } from '@/lib/errors';
import { requireSupabase } from '@/lib/supabase';
import { useNow } from '@/lib/useNow';

export type Pause = { startsOn: string; endsOn: string };

/** my_day_status: what the caller can do today in a pack. */
export type DayStatus = {
  day: string;
  restDaysPerWeek: number;
  restDaysLeft: number;
  jokerAvailable: boolean;
  passToday: 'joker' | 'rest' | null;
  fedToday: boolean;
  pause: Pause | null;
  pauseAvailableFrom: string | null;
};

export type TodayPasses = {
  /** Members with a joker or a declared rest today. */
  passes: Map<string, 'joker' | 'rest'>;
  /** Members on a pause that covers today. */
  paused: Set<string>;
};

/** members_today: what the pack screen doesn't load of today's close. */
export type MembersToday = {
  /** The pack day the answer is for. */
  day: string;
  restDaysPerWeek: number;
  members: { userId: string; membership: 'active' | 'sleeping' | 'left'; hasStarted: boolean; restDaysUsedThisWeek: number }[];
  /**
   * The input of the oldest day before today without a result. Only that day's close spends its
   * automatic rests, so until then a member here can have one rest day less than it says.
   */
  dayToClose: DayInput | null;
};

export const daysKey = ['days'] as const;
export const PAUSE_LENGTHS = [3, 7, 14, 30, 60] as const;

const pauseOn = (member: PackMember, day: string) => member.pauses?.find((pause) => pause.starts_on <= day && day <= pause.ends_on);

/**
 * The caller's pause that covers today, if any. Today's status is the server's word. A screen just
 * opened doesn't have it yet, and with no connection it can't: it is neither kept nor good for a new
 * day. The pack the phone holds says who is paused on any day.
 */
export function pauseToday(status: DayStatus | undefined, pack: Pack | null | undefined, userId: string | undefined, now: Date): Pause | null {
  if (status) return status.pause && status.pause.startsOn <= status.day ? status.pause : null;
  const member = pack?.pack_members.find((candidate) => candidate.user_id === userId);
  const pause = pack && member && pauseOn(member, packDayOf(now, readableZone(pack.timezone)));
  return pause ? { startsOn: pause.starts_on, endsOn: pause.ends_on } : null;
}

/** What the pack the phone holds says of today, until the server's answer is in. It has no passes. */
export function keptToday(pack: Pick<Pack, 'pack_members' | 'timezone'>, now: Date): TodayPasses {
  const today = packDayOf(now, readableZone(pack.timezone));
  return {
    passes: new Map(),
    paused: new Set(pack.pack_members.filter((member) => pauseOn(member, today)).map((member) => member.user_id)),
  };
}

/** Keyed by the pack day, so a screen left open past 03:00 asks again instead of showing yesterday. */
export function useDayStatus(packId: string) {
  const { data: pack } = usePack(packId);
  const now = useNow(60_000);
  const today = pack ? packDayOf(now, readableZone(pack.timezone)) : null;
  return useQuery({
    queryKey: [...daysKey, 'status', packId, today],
    // Once the pack is known, or known to be gone: then the server's refusal shows, not a spinner.
    enabled: pack !== undefined,
    queryFn: async (): Promise<DayStatus> => {
      const { data, error } = await requireSupabase().rpc('my_day_status', { target: packId });
      if (error) throw error;
      return data as DayStatus;
    },
    // A phone a little fast asks just before the server's 03:00 and gets yesterday back: it asks
    // again until the answer is for today.
    refetchInterval: (query) => (today !== null && query.state.data !== undefined && query.state.data.day < today ? 15_000 : false),
  });
}

/** Whether each member has started and the rest days they used, for the hatch steps. */
export function useMembersToday(pack: Pick<Pack, 'id' | 'timezone'> | undefined, now: Date, enabled: boolean) {
  const today = pack ? packDayOf(now, readableZone(pack.timezone)) : '';
  return useQuery({
    queryKey: [...daysKey, 'members', pack?.id, today],
    enabled: pack !== undefined && enabled,
    queryFn: async (): Promise<MembersToday> => {
      const { data, error } = await requireSupabase().rpc('members_today', { target: pack!.id });
      if (error) throw error;
      return data as MembersToday;
    },
    // Nothing announces the close of an egg day, and a phone a little fast asks just before the
    // server's 03:00, so it asks again until the day before closed and the answer is for today. A
    // server without dayToClose says neither, and its one answer stands.
    refetchInterval: (query) => {
      const answer = query.state.data;
      return answer && (answer.dayToClose || answer.day < today) ? 15_000 : false;
    },
  });
}

/** Today's passes and pauses of every member, for the circles on the pack screen. */
export function useTodayPasses(pack: Pick<Pack, 'id' | 'timezone'> | undefined, now: Date) {
  const today = pack ? packDayOf(now, readableZone(pack.timezone)) : '';
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

function useDayAction<T>(action: (packId: string, value: T) => PromiseLike<{ error: unknown }>, packId: string, onPack = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (value: T) => {
      const { error } = await action(packId, value);
      if (error) throw error;
    },
    // The spinner ends and the screen closes with the change on show. A refusal changed nothing, and
    // its message shouldn't wait for reads that may be failing too.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: daysKey }),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: daysKey });
    },
    // A pause is also in the pack, whose copy on the phone says so with no connection.
    onSettled: () => {
      if (onPack) void queryClient.invalidateQueries({ queryKey: packsKey });
    },
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
  return useDayAction<number>((target, days) => requireSupabase().rpc('start_pause', { target, days }), packId, true);
}

export function useEndPause(packId: string) {
  return useDayAction<void>((target) => requireSupabase().rpc('end_pause', { target }), packId, true);
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
  if (isBlockedText(error)) return 'errors.textNotAllowed' as const;
  return 'errors.saveFailed' as const;
}
