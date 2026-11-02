import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/lib/database.types';
import { clockRestored, clockedFetch, onPhoneClock, serverNow } from '@/lib/serverClock';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

type Client = SupabaseClient<Database>;

/** Where supabase-js keeps the session: its default key, named so the app can read it (AuthProvider). */
export const AUTH_STORAGE_KEY = url ? `sb-${new URL(url).hostname.split('.')[0]}-auth-token` : '';

/** How long auth-js holds the next refresh back after one failed. */
const REFRESH_HELD_MS = 60_000;

/**
 * auth-js sends no refresh until a moment on the phone's clock after one failed, and reads go out
 * without a token meanwhile. A clock set back since puts that moment further off than auth-js ever
 * does, by the size of the jump, so a moment that far off is forgotten. The offset can't be asked:
 * it never moved for a clock that went ahead and back with no connection. Every refresh starts by
 * reading the session, so that read does this. The field is private to auth-js: the typecheck and
 * wrongClock.test.tsx fail if it goes.
 */
function forgetFailedRefreshOfAnotherClock(): void {
  const auth = supabase?.auth;
  const heldUntil = auth?.['lastRefreshFailure']?.expiresAt ?? 0;
  if (auth && heldUntil - Date.now() > REFRESH_HELD_MS) auth['lastRefreshFailure'] = null;
}

/**
 * AsyncStorage, with a session's expires_at read as the phone's clock will show that moment. The
 * time is the server's and auth-js holds it against Date.now: a phone behind would keep a token the
 * server has expired, and one ahead would refresh on nearly every request and take a refused
 * refresh for a dead session. Only reads change, because auth-js stores what the server sent, not
 * what it read. updateUser is the exception, so the app stays away from it.
 */
const authStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const stored = await AsyncStorage.getItem(key);
    if (key !== AUTH_STORAGE_KEY || !stored) return stored;
    forgetFailedRefreshOfAnotherClock();
    await clockRestored;
    try {
      const session = JSON.parse(stored) as Partial<Session> | null;
      if (typeof session?.expires_at !== 'number') return stored;
      return JSON.stringify({ ...session, expires_at: onPhoneClock(session.expires_at) });
    } catch {
      // Damaged: auth-js takes that for no session.
      return stored;
    }
  },
  setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

let tokenlessRequest = false;

/**
 * Whether a request went out without the user's token since the last time this was asked: during
 * auth-js's wait after a failed refresh it has no session to hand out, and the key goes instead.
 */
export function tookTokenlessRequest(): boolean {
  const took = tokenlessRequest;
  tokenlessRequest = false;
  return took;
}

/**
 * Refusals that say nothing about the refresh token: project restricted, rate limit, project paused,
 * gateway time limit.
 */
const NOT_ABOUT_THE_TOKEN = new Set([402, 429, 540, 544]);

/**
 * The fetch behind every request. auth-js takes any refused refresh for a dead refresh token, and
 * with the access token run out it removes the session. On a refusal that says nothing about the
 * token it hears what a lost connection says instead: it tries again, and the session stays until a
 * refresh gets through. A token still good needs none of this, because auth-js keeps that session.
 */
const appFetch: typeof fetch = async (input, init) => {
  // auth-js's own calls always carry the key.
  if (!String(input).includes('/auth/v1/') && new Headers(init?.headers).get('authorization') === `Bearer ${publishableKey}`) {
    tokenlessRequest = true;
  }
  const response = await clockedFetch(input, init);
  if (!NOT_ABOUT_THE_TOKEN.has(response.status)) return response;
  if (!String(input).includes('/auth/v1/token?grant_type=refresh_token')) return response;
  const session = await storedSession();
  if (session && (session.expires_at ?? 0) * 1000 <= serverNow().getTime()) throw new TypeError('Refresh not served');
  return response;
};

/** Null until .env points at a Supabase project, so the app still opens before the backend exists. */
export const supabase: Client | null =
  url && publishableKey
    ? createClient<Database>(url, publishableKey, {
        auth: {
          storage: authStorage,
          storageKey: AUTH_STORAGE_KEY,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
        // TanStack Query already retries failed reads; a second layer inside supabase-js made an
        // offline screen spin for half a minute before it could say so.
        db: { retry: false },
        global: { fetch: appFetch },
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
