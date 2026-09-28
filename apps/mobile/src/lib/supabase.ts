import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/lib/database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type Client = SupabaseClient<Database>;

/** Null until .env points at a Supabase project, so the app still opens before the backend exists. */
export const supabase: Client | null =
  url && publishableKey
    ? createClient<Database>(url, publishableKey, {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
        // TanStack Query already retries failed reads; a second layer inside supabase-js made an
        // offline screen spin for half a minute before it could say so.
        db: { retry: false },
      })
    : null;

// Refresh tokens only while the app is in the foreground.
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
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
