import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { OutgoingFeed } from '@/features/feeds/send';

// The real auth-js and the app's own client, feed queue and send, against a stand-in for the
// server that keeps the machine's time. The phone's clock is that time plus phoneAhead.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

// Files are just names here, as in the queue test.
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    async copy() {}
    delete() {}
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  }
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {}
  }
  return { File, Directory, Paths: { document: { uri: 'documents' } } };
});
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
}));
// One account stays on this phone here, so nothing of what an account leaves behind comes up.
jest.mock('@/features/auth/signIn', () => ({ forgetOtherAccounts: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));

type Supabase = typeof import('@/lib/supabase');

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<Supabase>('@/lib/supabase');
const { noteServerDate } = jest.requireActual<typeof import('@/lib/serverClock')>('@/lib/serverClock');
const { AuthProvider, useAuth } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>(
  '@/features/auth/AuthProvider',
);
const { useSendFeed } = jest.requireActual<typeof import('@/features/feeds/api')>('@/features/feeds/api');
const { flushQueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const OFFSET_KEY = 'gozali.server-offset';
const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };

const machineNow = Date.now.bind(Date);
const serverSeconds = () => Math.floor(machineNow() / 1000);
let phoneAhead = 0;

/** When each access token dies, on the server's clock. */
const tokenExpiry = new Map<string, number>();
const requests: string[] = [];
const tokenCalls = () => requests.filter((path) => path === '/auth/v1/token').length;
const savedFeeds: string[] = [];
let refreshRefusal: number | null = null;

function answer(status: number, body: unknown) {
  const headers = { 'content-type': 'application/json', date: new Date(machineNow()).toUTCString() };
  return new Response(JSON.stringify(body), { status, headers });
}

function server(url: URL, bearer: string | null) {
  if (url.pathname === '/auth/v1/token') {
    if (refreshRefusal !== null) return answer(refreshRefusal, { error_code: 'over_request_rate_limit', msg: 'Slow down' });
    const access = `fresh-${tokenCalls()}`;
    const expires_at = serverSeconds() + 3600;
    tokenExpiry.set(access, expires_at);
    return answer(200, {
      access_token: access,
      refresh_token: `refresh-${tokenCalls()}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at,
      user: USER,
    });
  }
  const alive = (tokenExpiry.get(bearer ?? '') ?? 0) > serverSeconds();
  if (url.pathname.startsWith('/storage/v1/object/')) {
    if (!alive) return answer(400, { statusCode: '403', error: 'Unauthorized', message: '"exp" claim timestamp check failed' });
    return answer(200, { Id: 'object', Key: url.pathname });
  }
  if (!alive) return answer(401, { code: 'PGRST303', message: 'JWT expired', details: null, hint: null });
  if (url.pathname !== '/rest/v1/rpc/submit_feed') return answer(200, []);
  savedFeeds.push(url.pathname);
  return answer(200, 'feed-id');
}

let sessions = 0;

/** Stores a session whose token dies at that time on the server's clock. */
async function storeSession(expires_at: number) {
  tokenExpiry.set('old', expires_at);
  // auth-js remembers a refused refresh by its token for a while, so each test has its own.
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

const storedExpiry = async () => {
  const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
  return stored ? (JSON.parse(stored) as Session).expires_at : null;
};

/** What the phone learns from any answer of the server. */
const hearFromServer = () => noteServerDate(new Date(machineNow()).toUTCString(), Date.now(), Date.now());

/** The client as the next start of the app makes it. */
function clientAfterRestart() {
  let client: ReturnType<Supabase['requireSupabase']> | undefined;
  jest.isolateModules(() => {
    client = jest.requireActual<Supabase>('@/lib/supabase').requireSupabase();
  });
  return client!;
}

const withQueryClient = (screen: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } })}>{screen}</QueryClientProvider>
);

beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => machineNow() + phoneAhead);
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    return server(url, new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? null);
  }) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
  jest.restoreAllMocks();
});

beforeEach(async () => {
  phoneAhead = 0;
  refreshRefusal = null;
  hearFromServer();
  await AsyncStorage.clear();
  tokenExpiry.clear();
  requests.length = 0;
  savedFeeds.length = 0;
});

describe('a session on a phone three hours behind the server', () => {
  beforeEach(() => {
    phoneAhead = -3 * HOUR;
    hearFromServer();
  });

  it('renews a token the server has expired, though the phone sees hours left on it', async () => {
    await storeSession(serverSeconds() - 120);
    const { data } = await requireSupabase().auth.getSession();
    expect(tokenCalls()).toBe(1);
    expect(data.session?.access_token).toBe('fresh-1');
  });

  it('gets its reads answered', async () => {
    await storeSession(serverSeconds() - 120);
    const { status } = await requireSupabase().from('profiles').select('id');
    expect(status).toBe(200);
    expect(tokenCalls()).toBe(1);
  });

  it('leaves a good token alone', async () => {
    await storeSession(serverSeconds() + 1800);
    for (let read = 0; read < 4; read += 1) await requireSupabase().from('profiles').select('id');
    expect(tokenCalls()).toBe(0);
  });

  it('stores the time the server gave the renewed session', async () => {
    await storeSession(serverSeconds() - 120);
    await requireSupabase().auth.getSession();
    expect(Math.abs((await storedExpiry())! - (serverSeconds() + 3600))).toBeLessThanOrEqual(2);
  });

  it('leaves the stored session as it was over reads', async () => {
    const expires = serverSeconds() + 1800;
    await storeSession(expires);
    for (let read = 0; read < 4; read += 1) await requireSupabase().auth.getSession();
    expect(await storedExpiry()).toBe(expires);
  });
});

describe('a session on a phone five minutes behind the server', () => {
  it('renews a token as soon as the server expires it', async () => {
    phoneAhead = -5 * MINUTE;
    hearFromServer();
    await storeSession(serverSeconds() - 120);
    await requireSupabase().auth.getSession();
    expect(tokenCalls()).toBe(1);
  });
});

describe('a session on a phone three hours ahead of the server', () => {
  beforeEach(() => {
    phoneAhead = 3 * HOUR;
    hearFromServer();
  });

  it('makes no refresh over eight reads of a good token', async () => {
    await storeSession(serverSeconds() + 3000);
    for (let read = 0; read < 8; read += 1) await requireSupabase().from('profiles').select('id');
    expect(tokenCalls()).toBe(0);
  });

  it('still renews a token the server is about to expire', async () => {
    await storeSession(serverSeconds() + 30);
    await requireSupabase().auth.getSession();
    expect(tokenCalls()).toBe(1);
  });
});

describe('a phone that went three hours ahead since it last heard from the server', () => {
  it('learns better from a refused refresh, and stays signed in on its good token', async () => {
    phoneAhead = 3 * HOUR;
    await storeSession(serverSeconds() + 1800);
    refreshRefusal = 429;
    const { data } = await requireSupabase().auth.getSession();
    expect(tokenCalls()).toBe(1);
    expect(data.session?.access_token).toBe('old');
    expect(await storedExpiry()).not.toBeNull();
  });
});

describe('a session after a restart', () => {
  it('uses the offset the last run saved from the first read on', async () => {
    phoneAhead = -3 * HOUR;
    await AsyncStorage.setItem(OFFSET_KEY, String(3 * HOUR));
    await storeSession(serverSeconds() - 120);
    const client = clientAfterRestart();
    const { data } = await client.auth.getSession();
    await client.auth.stopAutoRefresh();
    expect(tokenCalls()).toBe(1);
    expect(data.session?.access_token).toBe('fresh-1');
  });

  it('waits for that offset, however long it takes to come back', async () => {
    phoneAhead = -3 * HOUR;
    await AsyncStorage.setItem(OFFSET_KEY, String(3 * HOUR));
    await storeSession(serverSeconds() - 120);
    const read = jest.mocked(AsyncStorage.getItem);
    const instantly = read.getMockImplementation()!;
    read.mockImplementationOnce(async (key) => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return instantly(key);
    });
    const client = clientAfterRestart();
    await client.auth.getSession();
    await client.auth.stopAutoRefresh();
    expect(tokenCalls()).toBe(1);
  });

  it('spends no refresh on a good token on a phone ahead', async () => {
    phoneAhead = 3 * HOUR;
    await AsyncStorage.setItem(OFFSET_KEY, String(-3 * HOUR));
    await storeSession(serverSeconds() + 1800);
    const client = clientAfterRestart();
    await client.auth.getSession();
    await client.auth.stopAutoRefresh();
    expect(tokenCalls()).toBe(0);
  });
});

describe('a session on a phone with the right clock', () => {
  it('keeps a good token', async () => {
    await storeSession(serverSeconds() + 1800);
    for (let read = 0; read < 4; read += 1) await requireSupabase().from('profiles').select('id');
    expect(tokenCalls()).toBe(0);
  });

  it('renews an expired one', async () => {
    await storeSession(serverSeconds() - 120);
    await requireSupabase().auth.getSession();
    expect(tokenCalls()).toBe(1);
  });
});

describe('what auth-js keeps next to the session', () => {
  it('finds the sign-in code verifier on a phone whose clock is off', async () => {
    phoneAhead = -3 * HOUR;
    hearFromServer();
    await requireSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'gozali://auth/callback', skipBrowserRedirect: true },
    });
    const { error } = await requireSupabase().auth.exchangeCodeForSession('code-from-the-browser');
    expect(error).toBeNull();
    expect(tokenCalls()).toBe(1);
  });

  it('takes a damaged session for none', async () => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, 'not json');
    const { data, error } = await requireSupabase().auth.getSession();
    expect(data.session).toBeNull();
    expect(error).toBeNull();
  });
});

describe('opening the app without a connection', () => {
  it("doesn't wait for the refresh of a token the server has expired, on a phone behind", async () => {
    phoneAhead = -3 * HOUR;
    hearFromServer();
    await storeSession(serverSeconds() - 120);
    // A refresh with no connection takes half a minute of retries to give up.
    let connect: (response: Response) => void = () => undefined;
    jest.mocked(globalThis.fetch).mockReturnValueOnce(new Promise((resolve) => (connect = resolve)));

    let seen: ReturnType<typeof useAuth> | null = null;
    function Screen() {
      seen = useAuth();
      return null;
    }
    let app: ReactTestRenderer;
    await act(async () => {
      app = create(
        withQueryClient(
          <AuthProvider>
            <Screen />
          </AuthProvider>,
        ),
      );
    });

    expect(seen!.loading).toBe(false);
    expect(seen!.session?.access_token).toBe('old');
    await act(async () => app.unmount());
    connect(server(new URL('http://gozali.test/auth/v1/token'), null));
  });
});

describe('the Send button on a phone whose clock is off', () => {
  const feed: OutgoingFeed = {
    id: 'a',
    packId: 'pack',
    userId: 'noa',
    photoUri: 'cache/a.jpg',
    caption: null,
    capturedAt: '2026-11-01T20:00:00Z',
    focusMinutes: null,
    extra: false,
  };

  async function tapSend(): Promise<'sent' | 'queued'> {
    let send: ReturnType<typeof useSendFeed>['mutateAsync'] | null = null;
    function Screen() {
      send = useSendFeed().mutateAsync;
      return null;
    }
    let screen: ReactTestRenderer;
    await act(async () => {
      screen = create(withQueryClient(<Screen />));
    });
    let outcome: 'sent' | 'queued' | undefined;
    await act(async () => {
      outcome = await send!(feed);
    });
    await act(async () => screen.unmount());
    return outcome!;
  }

  it('sends through a token that died, on a phone behind that knows its offset', async () => {
    phoneAhead = -3 * HOUR;
    hearFromServer();
    await storeSession(serverSeconds() - 120);
    expect(await tapSend()).toBe('sent');
    expect(savedFeeds).toHaveLength(1);
    expect(tokenCalls()).toBe(1);
  });

  it('sends on a good token, on a phone ahead that knows its offset', async () => {
    phoneAhead = 3 * HOUR;
    hearFromServer();
    await storeSession(serverSeconds() + 1800);
    expect(await tapSend()).toBe('sent');
    expect(savedFeeds).toHaveLength(1);
    expect(tokenCalls()).toBe(0);
  });

  it('queues the feed if the clock moved since the last answer, and the next flush sends it', async () => {
    phoneAhead = -3 * HOUR;
    await storeSession(serverSeconds() - 120);
    expect(await tapSend()).toBe('queued');
    expect(savedFeeds).toEqual([]);

    expect((await flushQueue()).handled).toBe(1);
    expect(savedFeeds).toHaveLength(1);
    expect(await pendingFeeds()).toEqual([]);
  });
});
