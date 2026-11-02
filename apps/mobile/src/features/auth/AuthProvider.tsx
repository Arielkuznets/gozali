import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { forgetNotificationsOfOthers } from '@/features/auth/signIn';
import { suggestName } from '@/features/profile/suggestedName';
import { clearWidgets } from '@/features/widgets/sync';
import { forgetKeptQueries } from '@/lib/queryCache';
import { clockRestored, serverNow } from '@/lib/serverClock';
import { storedSession, supabase, tookTokenlessRequest } from '@/lib/supabase';

/** Whether a stored session's access token has expired, or is about to, so it needs a refresh. */
function hasExpired(session: Session): boolean {
  return (session.expires_at ?? 0) * 1000 < serverNow().getTime() + 90_000;
}

/** Whether a read on screen failed its last try, even if it hasn't given up yet. */
function hasFailedRead(queryClient: QueryClient): boolean {
  return queryClient.getQueryCache().getAll().some((query) => query.isActive() && query.state.fetchFailureCount > 0);
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
    void Promise.all([storedSession(), clockRestored]).then(([stored]) => {
      if (!answered && stored && hasExpired(stored)) setState({ session: stored, loading: false });
    });
    void supabase.auth.getSession().then(async ({ data, error }) => {
      answered = true;
      const session = data.session ?? (isAuthRetryableFetchError(error) ? await storedSession() : null);
      setState({ session, loading: false });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Asked at every change, so what went out signed out says nothing about a later refresh.
      const tokenless = tookTokenlessRequest();
      // Nothing cached for one person may show to the next one on this phone.
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        suggestName(null);
        void forgetKeptQueries().catch(() => undefined);
        void clearWidgets().catch(() => undefined);
      }
      // After a failed refresh auth-js waits a minute before the next, connection or not, and reads
      // go out without a token meanwhile: most are refused, and storage answers as if to nobody. So
      // all of them go again, but only after such a read or a failure, as reads waiting for this
      // refresh are fine. A failure alone comes too late for a read still on its way.
      if (event === 'TOKEN_REFRESHED' && (tokenless || hasFailedRead(queryClient))) void queryClient.invalidateQueries();
      if (session) void forgetNotificationsOfOthers(session.user.id).catch(() => undefined);
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
