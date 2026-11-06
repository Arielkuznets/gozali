import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// The real auth-js and the app's own client and auth provider, against a stand-in for the server
// that turns down as many token requests as the test says, the way its rate limit does.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

jest.mock('@/features/auth/signIn', () => ({ forgetNotificationsOfOthers: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');
const { AuthProvider, useAuth } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>(
  '@/features/auth/AuthProvider',
);

const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const nowSeconds = () => Math.floor(Date.now() / 1000);

let limited = 0;
let tokenRequests: string[] = [];
const refreshes = () => tokenRequests.filter((search) => search === '?grant_type=refresh_token').length;

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
  });
}

function server(url: URL) {
  if (url.pathname !== '/auth/v1/token') return answer(200, []);
  tokenRequests.push(url.search);
  if (limited > 0) {
    limited -= 1;
    return answer(429, { error_code: 'over_request_rate_limit', msg: 'Slow down' });
  }
  return answer(200, {
    access_token: 'fresh',
    refresh_token: `fresh-refresh-${tokenRequests.length}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSeconds() + 3600,
    user: USER,
  });
}

let sessions = 0;

/** Stores a session whose access token dies at that time; auth-js remembers a failure by refresh token. */
async function storeSession(expires_at: number) {
  sessions += 1;
  const session = {
    access_token: 'old',
    refresh_token: `old-refresh-${sessions}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at,
    user: USER,
  };
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

const storedAccess = async () => {
  const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
  return stored ? (JSON.parse(stored) as Session).access_token : null;
};

/** The session as a read finds it, once auth-js is done with its tries on the test's clock. */
async function readSession() {
  let done = false;
  const reading = requireSupabase()
    .auth.getSession()
    .finally(() => {
      done = true;
    });
  while (!done) await jest.advanceTimersByTimeAsync(1000);
  return reading;
}

/** What the app heard about the session, in order. */
let events: string[] = [];
let stopListening = () => {};

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => server(new URL(String(input)))) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  limited = 0;
  tokenRequests = [];
  events = [];
  const { data } = requireSupabase().auth.onAuthStateChange((event) => {
    events.push(event);
  });
  stopListening = () => data.subscription.unsubscribe();
});

afterEach(() => {
  stopListening();
  jest.useRealTimers();
});

describe('a refresh turned down for going too fast, with the access token run out', () => {
  it('leaves the session where it is and tries again', async () => {
    await storeSession(nowSeconds() - 120);
    limited = 1;
    const { data, error } = await requireSupabase().auth.getSession();
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe('fresh');
    expect(refreshes()).toBe(2);
    expect(events).not.toContain('SIGNED_OUT');
  });

  it('keeps the session through every try, and the next refresh after them goes through', async () => {
    await storeSession(nowSeconds() - 120);
    limited = Infinity;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    const { data, error } = await readSession();
    expect(refreshes()).toBeGreaterThan(1);
    expect(data.session).toBeNull();
    expect(isAuthRetryableFetchError(error)).toBe(true);
    expect(await storedAccess()).toBe('old');
    expect(events).not.toContain('SIGNED_OUT');

    limited = 0;
    await jest.advanceTimersByTimeAsync(60_000);
    expect((await readSession()).data.session?.access_token).toBe('fresh');
  });

  it('keeps the person in the app', async () => {
    await storeSession(nowSeconds() - 120);
    limited = Infinity;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });

    let seen: ReturnType<typeof useAuth> | null = null;
    function Screen() {
      seen = useAuth();
      return null;
    }
    let app: ReactTestRenderer;
    await act(async () => {
      app = create(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <Screen />
          </AuthProvider>
        </QueryClientProvider>,
      );
      await readSession();
    });

    expect(seen!.loading).toBe(false);
    expect(seen!.session?.access_token).toBe('old');
    await act(async () => app.unmount());
  });
});

describe('a refresh turned down for going too fast, with the access token still good', () => {
  it('goes on with that token after one try, as it does for any refused refresh', async () => {
    await storeSession(nowSeconds() + 30);
    limited = Infinity;
    const { data, error } = await requireSupabase().auth.getSession();
    expect(error).toBeNull();
    expect(data.session?.access_token).toBe('old');
    expect(refreshes()).toBe(1);
  });
});

describe('a sign-in turned down for going too fast', () => {
  it('answers with the refusal after one try', async () => {
    limited = Infinity;
    const { error } = await requireSupabase().auth.signInWithPassword({ email: 'noa@gozali.test', password: 'password' });
    expect(error?.status).toBe(429);
    expect(tokenRequests).toEqual(['?grant_type=password']);
  });
});
