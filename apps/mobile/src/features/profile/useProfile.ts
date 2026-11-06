import NetInfo from '@react-native-community/netinfo';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/AuthProvider';
import { forgetOtherAccounts } from '@/features/auth/signIn';
import { hasConnection } from '@/features/feeds/queue';
import { renameMember } from '@/features/packs/api';
import { clearWidgetsLeftBehind } from '@/features/widgets/sync';
import { deviceTimeZone } from '@/lib/dates';
import { askForNotificationsOnce, forgetNotificationsAsked } from '@/lib/notifications';
import { registerPushToken, unregisterWhileSignedOut } from '@/lib/push';
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

/**
 * The screen the root layout's guards let this person open, or null until the profile is known.
 * A route outside the guards leaves for this one: going to a guarded screen does nothing at all.
 */
export function useHomeRoute(): '/' | '/profile-setup' | '/welcome' | null {
  const { session } = useAuth();
  const { data: profile } = useProfile();
  if (!session) return '/welcome';
  if (!profile) return null;
  return isProfileComplete(profile) ? '/' : '/profile-setup';
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
          // Only says they were accepted: the server stamps when, by its own clock.
          terms_accepted_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await forgetNotificationsAsked();
      await queryClient.invalidateQueries({ queryKey: profileKey(userId) });
    },
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
    // A change to the notification choices reads the saved ones and writes them back with its own,
    // so changes go one at a time: two at once would each write over the other.
    scope: { id: 'profile-settings' },
    mutationFn: async (settings: ProfileSettings) => {
      if (userId === undefined) throw new Error('Not signed in');
      const supabase = requireSupabase();
      let change = settings;
      // The choices are one column, and this phone's copy of it can be behind another phone's: the
      // saved choices go back with only this change on them.
      if (settings.notification_prefs) {
        const saved = await supabase.from('profiles').select('notification_prefs').eq('id', userId).single();
        if (saved.error) throw saved.error;
        const prefs = saved.data.notification_prefs as Profile['notification_prefs'];
        change = { ...settings, notification_prefs: { ...prefs, ...settings.notification_prefs } };
      }
      const { error } = await supabase.from('profiles').update(change).eq('id', userId);
      if (error) throw error;
    },
    onMutate: async (settings) => {
      await queryClient.cancelQueries({ queryKey: profileKey(userId) });
      const before = queryClient.getQueryData<Profile>(profileKey(userId));
      const { notification_prefs: prefs, ...fields } = settings;
      queryClient.setQueryData<Profile>(
        profileKey(userId),
        (profile) => profile && { ...profile, ...fields, notification_prefs: { ...profile.notification_prefs, ...prefs } },
      );
      return { before };
    },
    onSuccess: (_data, { display_name: name }) => {
      if (userId !== undefined && name) renameMember(queryClient, userId, name);
    },
    // A change that didn't save goes back on screen; offline the refetch below can't fix it.
    onError: (_error, settings, saved) => {
      const before = saved?.before;
      if (before) queryClient.setQueryData<Profile>(profileKey(userId), (profile) => profile && withoutChange(profile, settings, before));
    },
    // The server's copy only once nothing else waits: it would overwrite the changes still queued.
    // Not returned: a failed change is told at once, not after reads that may be failing too.
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: settingsKey }) === 1) {
        void queryClient.invalidateQueries({ queryKey: profileKey(userId) });
      }
    },
  });
}

/**
 * Keeps the account in step with the device on each start: the time zone reminders and quiet
 * hours use, this device's push token, and what another account left here.
 */
export function useAccountSync() {
  const { session } = useAuth();
  const profile = useProfile();
  const { mutate: updateProfile } = useUpdateProfile();
  const userId = session?.user.id;
  const zone = profile.data?.timezone;
  // Once per zone until the app or the connection comes back: the server saves a zone it doesn't
  // know as UTC (a phone's list of zones can be newer than the server's), so the device's zone never
  // shows up and would be sent on every answer.
  const sentZone = useRef<string | null>(null);
  const [zoneChecks, setZoneChecks] = useState(0);

  useEffect(() => {
    const device = deviceTimeZone();
    if (zone === undefined || zone === device || sentZone.current === device) return;
    sentZone.current = device;
    updateProfile({ timezone: device });
  }, [zone, updateProfile, zoneChecks]);

  // A phone can keep the app in the background through a flight, and a save without a connection
  // fails, so the zone is looked at again on each return to the app and once the connection is back.
  useEffect(() => {
    const checkAgain = () => {
      sentZone.current = null;
      setZoneChecks((count) => count + 1);
    };
    const appState = AppState.addEventListener('change', (state) => state === 'active' && checkAgain());
    let offline = false;
    const network = NetInfo.addEventListener((state) => {
      if (offline && hasConnection(state)) checkAgain();
      offline = !hasConnection(state);
    });
    return () => {
      appState.remove();
      network();
    };
  }, []);

  // Also on coming back to the app: permission may have been granted in the meantime.
  useEffect(() => {
    if (!userId) return;
    void forgetOtherAccounts(userId).catch(() => undefined);
    void registerPushToken();
    void sendPendingCrash();
    void askForNotificationsOnce();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void registerPushToken();
    });
    return () => subscription.remove();
  }, [userId]);
}

/**
 * Nobody signed in means nobody's pushes and widgets. A sign-out without a connection can't tell the
 * server, and a session the server ends never signs out here at all, so each start, each return to
 * the app and each time the connection comes back try until the server has forgotten the token.
 */
export function useSignedOutSync() {
  const { session, loading } = useAuth();
  const signedOut = !loading && session === null;

  useEffect(() => {
    if (!signedOut) return;
    void unregisterWhileSignedOut();
    void clearWidgetsLeftBehind().catch(() => undefined);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void unregisterWhileSignedOut();
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected) void unregisterWhileSignedOut();
    });
    return () => {
      appState.remove();
      network();
    };
  }, [signedOut]);
}
