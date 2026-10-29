import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { forgetKeptQueries } from '@/lib/queryCache';
import { AUTH_STORAGE_KEY, supabase } from '@/lib/supabase';

/** Whether a stored session's access token has expired, or is about to, so it needs a refresh. */
function hasExpired(session: Session): boolean {
  return (session.expires_at ?? 0) * 1000 < Date.now() + 90_000;
}

/** The session as stored, even with an access token that has expired. */
async function storedSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    const session = raw ? (JSON.parse(raw) as Session) : null;
    return session?.user?.id ? session : null;
  } catch {
    return null;
  }
}

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: supabase !== null });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase) return;
    // An access token that has expired waits for its refresh, and without a connection there is no
    // session to hand out (only after half a minute of retries does getSession give up). The person
    // is still signed in: the stored session says who they are, so the app opens on their packs and
    // the camera can queue a feed, while the refresh carries on.
    let answered = false;
    void storedSession().then((stored) => {
      if (!answered && stored && hasExpired(stored)) setState({ session: stored, loading: false });
    });
    void supabase.auth.getSession().then(async ({ data, error }) => {
      answered = true;
      const session = data.session ?? (isAuthRetryableFetchError(error) ? await storedSession() : null);
      setState({ session, loading: false });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Nothing cached for one person may show to the next one on this phone.
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        void forgetKeptQueries().catch(() => undefined);
      }
      // An offline start keeps the stored session until a real one (or a sign-out) comes.
      if (event === 'INITIAL_SESSION' && !session) return;
      setState({ session, loading: false });
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
