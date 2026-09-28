import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';

/** The one row of public.app_config: what the server asks of the installed apps. */
export type AppConfig = {
  min_version: string;
  ios_url: string | null;
  android_url: string | null;
  apple_revocation: boolean;
};

/** The installed version, like 1.2.0 (updates without the store keep it, see docs/setup.md). */
export function installedVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

/** Whether version `a` is older than `b`, comparing major, minor and patch as numbers. */
export function isOlder(a: string, b: string): boolean {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

/** Read when the app starts and again every hour; without a connection the app just carries on. */
export function useAppConfig() {
  return useQuery({
    queryKey: ['app-config'],
    enabled: supabase !== null,
    staleTime: 60 * 60_000,
    queryFn: async (): Promise<AppConfig | null> => {
      const { data, error } = await supabase!
        .from('app_config')
        .select('min_version, ios_url, android_url, apple_revocation')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
