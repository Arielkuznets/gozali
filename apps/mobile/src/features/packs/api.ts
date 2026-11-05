import { addDays } from '@gozali/game-engine';
import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { isNetworkFailure } from '@/features/feeds/send';
import type { Category, CritterStage, CritterStatus, Species, WeekStart } from '@/features/packs/constants';
import { notify } from '@/lib/confirm';
import { deviceTimeZone } from '@/lib/dates';
import { errorMessage, isBlockedText } from '@/lib/errors';
import { serverNow } from '@/lib/serverClock';
import { requireSupabase } from '@/lib/supabase';

export type PackPause = { starts_on: string; ends_on: string };

export type PackMember = {
  user_id: string;
  role: 'admin' | 'member';
  status: 'active' | 'sleeping' | 'left';
  joined_at: string;
  profiles: { display_name: string | null; avatar_path: string | null } | null;
  /** Their pauses that aren't over. A copy kept by an older build doesn't have this. */
  pauses?: PackPause[];
};

export type PackCritter = {
  species: Species;
  name: string | null;
  health: number;
  xp: number;
  stage: CritterStage;
  status: CritterStatus;
  streak: number;
  /** The pack's coins for the outfit shop. */
  coins: number;
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
  critters ( species, name, health, xp, stage, status, streak, coins, marks, outfit ),
  pack_members ( user_id, role, status, joined_at, profiles ( display_name, avatar_path ), pauses ( starts_on, ends_on ) )
`;

const PAUSE_END = 'pack_members.pauses.ends_on';
/** Older pauses cover no day from here on in any time zone, and would add to every read for good. */
const pausesFrom = () => addDays(serverNow().toISOString().slice(0, 10), -2);

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

/**
 * The rest days a week in force on a pack day. New ones count from their first day, as the server
 * has them (pack_week_on), though they stay pending until a day close takes them over.
 */
export function restDaysOn(pack: Pick<Pack, 'rest_days_per_week' | 'pending_rest_days_per_week' | 'pending_from'>, day: string): number {
  const started = pack.pending_from !== null && pack.pending_from <= day;
  return started ? (pack.pending_rest_days_per_week ?? pack.rest_days_per_week) : pack.rest_days_per_week;
}

/** Puts a member's new name into the packs the phone holds, which a pack screen draws first. */
export function renameMember(queryClient: QueryClient, userId: string, name: string): void {
  const renamed = (pack: Pack): Pack => ({
    ...pack,
    pack_members: pack.pack_members.map((member) =>
      member.user_id === userId && member.profiles ? { ...member, profiles: { ...member.profiles, display_name: name } } : member,
    ),
  });
  queryClient.setQueriesData<Pack[] | Pack | null>({ queryKey: packsKey }, (packs) =>
    Array.isArray(packs) ? packs.map(renamed) : packs && renamed(packs),
  );
}

/**
 * Brings the phone up to a pack the server has just said the person is in. A null kept from when
 * they weren't goes first: a pack screen would open on it and say the pack isn't here, and the
 * list's copy doesn't replace a null. The feeds are read again for a pack screen left underneath,
 * which the person goes back to: it read them from outside the pack, which comes back empty.
 */
export function refreshJoinedPack(queryClient: QueryClient, id: string): void {
  void queryClient.resetQueries({ queryKey: packKey(id), predicate: (query) => query.state.data === null });
  void queryClient.invalidateQueries({ queryKey: packsKey });
  void queryClient.invalidateQueries({ queryKey: ['feeds'] });
}

export function useMyPacks() {
  return useQuery({
    queryKey: packsKey,
    queryFn: async (): Promise<Pack[]> => {
      // Row level security returns only the caller's packs.
      const { data, error } = await requireSupabase().from('packs').select(PACK_FIELDS).gte(PAUSE_END, pausesFrom()).order('created_at');
      if (error) throw error;
      // A list is never null: no data is an answer cut off before its body, and kept it would stay.
      if (!data) throw new Error('no_answer');
      return data as unknown as Pack[];
    },
  });
}

async function readPack(id: string): Promise<Pack | null> {
  const { data, error } = await requireSupabase().from('packs').select(PACK_FIELDS).gte(PAUSE_END, pausesFrom()).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as unknown as Pack | null;
}

export function usePack(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: packKey(id),
    // The home list holds the pack, so a first open draws at once, also offline. It keeps the
    // list's time: a screen must not take this for what the server has just answered.
    initialData: () => queryClient.getQueryData<Pack[]>(packsKey)?.find((pack) => pack.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(packsKey)?.dataUpdatedAt,
    // Null once the pack isn't visible (left or removed), so screens can say so instead of
    // keeping the last copy on screen.
    queryFn: () => readPack(id),
  });
}

/** The preview's refusal of this member, which another try would only repeat. */
export function previewRefusal(error: unknown) {
  const key = packErrorKey(error);
  return key === 'packs.errors.removed' || key === 'packs.errors.tooManyAttempts' ? key : null;
}

export function usePackPreview(code: string) {
  return useQuery({
    queryKey: ['pack-preview', code],
    enabled: code.length === 8,
    retry: (failures, error) => failures < 3 && previewRefusal(error) === null,
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

/**
 * How long before a create the pack it made can be dated: the phone's clock can be a minute off the
 * server's, and an answer can take half a minute to fail.
 */
const MADE_WITHIN_MS = 5 * 60_000;

/** The packs creates in this run went on to, which the list may not hold yet while its read stalls. */
const createdThisRun = new Set<string>();

/**
 * The newest pack made as this create would have made it, by the caller, since then, that the phone
 * didn't know of. A read that fails finds none.
 */
async function packMadeSince(pack: NewPack, since: string, known: ReadonlySet<string>, userId: string | undefined): Promise<string | null> {
  const { data } = await requireSupabase()
    .from('packs')
    .select('id, category, custom_habit, rest_days_per_week, critters ( species ), pack_members ( user_id, role )')
    .eq('name', pack.name)
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  const made = data?.find(
    (item) =>
      !known.has(item.id) &&
      item.category === pack.category &&
      item.custom_habit === (pack.customHabit || null) &&
      item.rest_days_per_week === pack.restDays &&
      item.critters?.species === pack.species &&
      item.pack_members.some((member) => member.user_id === userId && member.role === 'admin'),
  );
  return made?.id ?? null;
}

export function useCreatePack() {
  const queryClient = useQueryClient();
  const userId = useAuth().session?.user.id;
  return useMutation({
    mutationFn: async (pack: NewPack): Promise<string> => {
      const known = new Set([...createdThisRun, ...(queryClient.getQueryData<Pack[]>(packsKey)?.map((item) => item.id) ?? [])]);
      const since = new Date(serverNow().getTime() - MADE_WITHIN_MS).toISOString();
      const { data, error } = await requireSupabase().rpc('create_pack', {
        pack_name: pack.name,
        habit: pack.category,
        habit_text: pack.customHabit ?? undefined,
        rest_days: pack.restDays,
        species: pack.species,
        time_zone: deviceTimeZone(),
      });
      if (data) return data;
      // A create with no answer, or with one cut off before its body (no data and no error), may
      // have made the pack all the same, and a second try would make another, so it goes on with
      // the one it finds.
      const made = !error || isNetworkFailure(error) ? await packMadeSince(pack, since, known, userId) : null;
      if (made) return made;
      throw error ?? new Error('no_answer');
    },
    // Not returned here or on a join: the next screen reads the pack itself, and with the pack made
    // nobody should be held on this one by a stalled list.
    onSuccess: (packId) => {
      createdThisRun.add(packId);
      void queryClient.invalidateQueries({ queryKey: packsKey });
    },
  });
}

export function useJoinPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<string> => {
      const { data, error } = await requireSupabase().rpc('join_pack', { code });
      if (error) throw error;
      // A code that matches no pack comes back empty rather than as an error, so the server
      // can count the miss.
      if (data === null) throw new Error('invite_not_found');
      return data as string;
    },
    onSuccess: (packId) => refreshJoinedPack(queryClient, packId),
  });
}

export function useLeavePack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (packId: string) => {
      const { error } = await requireSupabase().rpc('leave_pack', { target: packId });
      // Already out: an earlier try got through and only its answer was lost.
      if (error && !error.message.includes('not_a_member')) throw error;
    },
    // Not returned: the person is out, and the way home shouldn't wait for reads that may be stalling.
    onSuccess: (_data, packId) => {
      queryClient.setQueryData<Pack[]>(packsKey, (packs) => packs?.filter((pack) => pack.id !== packId));
      void queryClient.invalidateQueries({ queryKey: packsKey });
    },
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
    // The form says Saved once the pack comes back with the new values, so the spinner holds for
    // that read and not for the list.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: packsKey, exact: true });
      return queryClient.invalidateQueries({ queryKey: packKey(packId) });
    },
  });
}

/** A renewal with no answer, once the pack has been read again: the code on screen works, new or not. */
const RENEWAL_UNCONFIRMED = 'renewal_unconfirmed';
/** A renewal with no answer, when the pack couldn't be read after it either: the code on screen may no longer work. */
const RENEWAL_UNREAD = 'renewal_unread';

/** Without a connection a request fails at once, so one that fails this soon is taken to have had none. */
const NO_CONNECTION_MS = 1000;

const renewKey = (packId: string) => ['renew-invite-code', packId] as const;

/** A new invite code for the pack (admin only); the old code and link stop working. */
export function useRenewInviteCode(packId: string) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationKey: renewKey(packId),
    mutationFn: async () => {
      const sentAt = Date.now();
      const { data, error } = await requireSupabase().rpc('renew_invite_code', { target: packId });
      if (data) return data;
      if (error && !isNetworkFailure(error)) throw error;
      // With no answer, or one cut off before its body, the code may have changed or not, and no code
      // the phone holds can tell which, as another phone can change it too. So none is taken for the
      // new one: the pack is read as it is now, and the code that read puts on screen is the one that
      // works. The read has its query's retries, for a link that comes back within seconds, but after
      // a renewal that found no connection it gets one try, so the admin hears at once, not after 7 s.
      const read = await (error && Date.now() - sentAt < NO_CONNECTION_MS
        ? readPack(packId).then((pack) => queryClient.setQueryData<Pack | null>(packKey(packId), pack))
        : queryClient
            .refetchQueries({ queryKey: packKey(packId), exact: true }, { throwOnError: true })
            .then(() => queryClient.getQueryData<Pack | null>(packKey(packId)))
      ).catch(() => null);
      throw new Error(read ? RENEWAL_UNCONFIRMED : RENEWAL_UNREAD);
    },
    // The name as the phone has it at the tap, for an alert that can come on any screen: the read
    // after a lost answer can find the pack gone.
    onMutate: () => queryClient.getQueryData<Pack | null>(packKey(packId))?.name,
    // The old code stopped working with this answer, so the screen takes the new one from it: a
    // stalled reload must not leave a dead code up to be shared.
    onSuccess: (code) => {
      queryClient.setQueryData<Pack | null>(packKey(packId), (pack) => pack && { ...pack, invite_code: code });
    },
    // Said here, not at the tap: callbacks of the tap don't run for a screen that closed meanwhile,
    // and an admin who left it taking the old code for dead has to hear that it may still let people in.
    // Without the answer it may have gone through or not, so only a refusal says it didn't. Android
    // cuts an alert's title after two lines, so the pack's name goes under it.
    onError: (error, _variables, name) => {
      const outcome = errorMessage(error);
      if (outcome === RENEWAL_UNCONFIRMED) notify(t('invite.renewUnconfirmed'), t('invite.renewUnconfirmedDetail', { name }));
      else if (outcome === RENEWAL_UNREAD) notify(t('invite.renewUnconfirmed'), t('invite.renewUnreadDetail', { name }));
      else notify(t(packErrorKey(error)));
    },
    // The list holds the code too, and a refusal can come from a pack that changed since it was read.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: packsKey });
    },
  });
}

/** Whether a new invite code for the pack is on its way, also one asked for on a screen closed since. */
export function useRenewingInviteCode(packId: string): boolean {
  return useIsMutating({ mutationKey: renewKey(packId) }) > 0;
}

export function useRemoveMember(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await requireSupabase().rpc('remove_member', { target: packId, member: userId });
      if (error) throw error;
    },
    // Not returned: the member goes from the list when the reload comes, and nothing waits for that.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: packsKey });
    },
  });
}

/** Maps the server's error codes to translation keys. */
export function packErrorKey(error: unknown) {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  if (message.includes('pack_limit_reached')) return 'packs.errors.limitReached' as const;
  if (message.includes('pack_full')) return 'packs.errors.full' as const;
  if (message.includes('invite_not_found')) return 'packs.errors.notFound' as const;
  if (message.includes('removed_from_pack')) return 'packs.errors.removed' as const;
  if (message.includes('too_many_attempts')) return 'packs.errors.tooManyAttempts' as const;
  if (message.includes('admin_only')) return 'packs.errors.adminOnly' as const;
  if (isBlockedText(error)) return 'errors.textNotAllowed' as const;
  return 'errors.saveFailed' as const;
}
