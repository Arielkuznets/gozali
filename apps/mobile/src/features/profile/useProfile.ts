import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCalendars, getLocales } from 'expo-localization';

import { useAuth } from '@/features/auth/AuthProvider';
import { requireSupabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  display_name: string | null;
  terms_accepted_at: string | null;
};

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
        .select('id, display_name, terms_accepted_at')
        .eq('id', userId ?? '')
        .single();
      if (error) throw error;
      return data;
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
          timezone: getCalendars()[0]?.timeZone ?? 'UTC',
          locale: getLocales()[0]?.languageCode ?? 'en',
          terms_accepted_at: new Date().toISOString(),
        })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileKey(userId) }),
  });
}
