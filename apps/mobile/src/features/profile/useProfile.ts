import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { deviceTimeZone } from '@/lib/dates';
import { registerPushToken } from '@/lib/push';
import { sendPendingCrash } from '@/lib/reportError';
import { requireSupabase } from '@/lib/supabase';

/** Notification types a member can turn off (spec section 8); all are on by default. */
export const NOTIFICATION_TYPES = [
  'friend_fed',
  'evening_reminder',
  'last_one',
  'nudge',
  'pet_state',
  'evolution',
  'still_in',
  'weekly_recap',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
  terms_accepted_at: string | null;
  timezone: string;
  locale: string;
  reminder_time: string;
  notification_prefs: Partial<Record<NotificationType, boolean>>;
};

export type ProfileSettings = Partial<Pick<Profile, 'display_name' | 'timezone' | 'locale' | 'reminder_time' | 'notification_prefs'>>;

export const NAME_MAX_LENGTH = 30;

const profileKey = (userId: string | undefined) => ['profile', userId] as const;

export function useProfile() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: profileKey(userId),
    enabled: userId !== undefined,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await requireSupabase()
        .from('profiles')
        .select('id, display_name, avatar_path, terms_accepted_at, timezone, locale, reminder_time, notification_prefs')
        .eq('id', userId ?? '')
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

/** Profile setup is done once there is a name and the age and terms were confirmed. */
export function isProfileComplete(profile: Profile | undefined): boolean {
  return Boolean(profile?.display_name && profile.terms_accepted_at);
}

/** Saves the name and confirmation, plus the device time zone that reminders are scheduled in. */
export function useCompleteProfile() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  return useMutation({
    mutationFn: async (displayName: string) => {
      if (userId === undefined) throw new Error('Not signed in');
      const { error } = await requireSupabase()
        .from('profiles')
        .update({
          display_name: displayName,
          timezone: deviceTimeZone(),
          locale: getLocales()[0]?.languageCode ?? 'en',
          terms_accepted_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKey(userId) }),
  });
}

const settingsKey = ['profile-settings'] as const;

/** The profile with one change taken back, leaving the notification choices it didn't touch. */
function withoutChange(profile: Profile, change: ProfileSettings, before: Profile): Profile {
  const { notification_prefs: prefs, ...fields } = change;
  const restored: Profile = { ...profile, ...Object.fromEntries(Object.keys(fields).map((key) => [key, before[key as keyof Profile]])) };
  if (prefs) {
    restored.notification_prefs = { ...profile.notification_prefs };
    for (const type of Object.keys(prefs) as NotificationType[]) {
      if (prefs[type] !== before.notification_prefs[type]) restored.notification_prefs[type] = before.notification_prefs[type];
    }
  }
  return restored;
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  return useMutation({
    mutationKey: settingsKey,
    // Each change sends all the notification choices, so changes go one at a time and each shows
    // in the profile at once: the next one is made from it.
    scope: { id: 'profile-settings' },
    mutationFn: async (settings: ProfileSettings) => {
      if (userId === undefined) throw new Error('Not signed in');
      const { error } = await requireSupabase().from('profiles').update(settings).eq('id', userId);
      if (error) throw error;
    },
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: profileKey(userId) });
      const before = queryClient.getQueryData<Profile>(profileKey(userId));
      queryClient.setQueryData<Profile>(profileKey(userId), (profile) => profile && { ...profile, ...settings });
      return { before };
    },
    // A change that didn't save goes back on screen; offline the refetch below can't fix it.
    onError: (_error, settings, saved) => {
      const before = saved?.before;
      if (before) queryClient.setQueryData<Profile>(profileKey(userId), (profile) => profile && withoutChange(profile, settings, before));
    },
    // The server's copy only once nothing else waits: it would overwrite the changes still queued.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: settingsKey }) === 1) {
        return queryClient.invalidateQueries({ queryKey: profileKey(userId) });
      }
    },
  });
}

/**
 * Keeps the account in step with the device on each start: the time zone reminders and quiet
 * hours use, and this device's push token.
 */
export function useAccountSync() {
  const { session } = useAuth();
  const profile = useProfile();
  const { mutate: updateProfile } = useUpdateProfile();
  const userId = session?.user.id;
  const zone = profile.data?.timezone;
  // Once per zone: the server saves a zone it doesn't know as UTC (Android names a zone picked by
  // hand like GMT+02:00), and sending it again on every answer went on while the app was open.
  const sentZone = useRef<string | null>(null);

  useEffect(() => {
    const device = deviceTimeZone();
    if (zone === undefined || zone === device || sentZone.current === device) return;
    sentZone.current = device;
    updateProfile({ timezone: device });
  }, [zone, updateProfile]);

  // Also on coming back to the app: permission may have been granted in the meantime.
  useEffect(() => {
    if (!userId) return;
    void registerPushToken();
    void sendPendingCrash();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerPushToken();
    });
    return () => subscription.remove();
  }, [userId]);
}
