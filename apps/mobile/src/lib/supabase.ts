import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/lib/database.types';
import { clockedFetch } from '@/lib/serverClock';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type Client = SupabaseClient<Database>;

/** Where supabase-js keeps the session: its default key, named so the app can read it (AuthProvider). */
export const AUTH_STORAGE_KEY = url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : '';

/** Null until .env points at a Supabase project, so the app still opens before the backend exists. */
export const supabase: Client | null =
  url && publishableKey
    ? createClient<Database>(url, publishableKey, {
        auth: {
          storage: AsyncStorage,
          storageKey: AUTH_STORAGE_KEY,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
        // TanStack Query already retries failed reads; a second layer inside supabase-js made an
        // offline screen spin for half a minute before it could say so.
        db: { retry: false },
        global: { fetch: clockedFetch },
      })
    : null;

// Refresh tokens only while the app is in the foreground.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** The session as stored, even with an access token that has expired. */
export async function storedSession(): Promise<Session | null> {
  try {
    const raw = AUTH_STORAGE_KEY ? await AsyncStorage.getItem(AUTH_STORAGE_KEY) : null;
    const session = raw ? (JSON.parse(raw) as Session) : null;
    return session?.user?.id ? session : null;
  } catch {
    return null;
  }
}

export class NotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured');
  }
}

export function requireSupabase(): Client {
  if (!supabase) throw new NotConfiguredError();
  return supabase;
}
