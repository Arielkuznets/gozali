import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCalendars, getLocales } from 'expo-localization';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { registerPushToken } from '@/lib/push';
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

function deviceTimeZone(): string {
  return getCalendars()[0]?.timeZone ?? 'UTC';
}

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

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id;
  return useMutation({
    mutationFn: async (settings: ProfileSettings) => {
      if (userId === undefined) throw new Error('Not signed in');
      const { error } = await requireSupabase().from('profiles').update(settings).eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKey(userId) }),
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

  useEffect(() => {
    if (zone !== undefined && zone !== deviceTimeZone()) updateProfile({ timezone: deviceTimeZone() });
  }, [zone, updateProfile]);

  // Also on coming back to the app: permission may have been granted in the meantime.
  useEffect(() => {
    if (!userId) return;
    void registerPushToken(userId);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerPushToken(userId);
    });
    return () => subscription.remove();
  }, [userId]);
}
