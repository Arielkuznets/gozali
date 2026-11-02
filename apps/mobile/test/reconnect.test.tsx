import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import type { OutgoingFeed } from '@/features/feeds/send';
import type { Pack } from '@/features/packs/api';

// The real auth-js and the app's own client, auth provider and reads, against a stand-in for the
// server that can be out of reach. Only what is native is replaced.
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
jest.mock('expo-image', () => ({ Image: { writeToCacheAsync: async () => undefined } }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/push', () => ({}));

type Connection = { isConnected: boolean };
let mockNetwork: Connection = { isConnected: true };
let mockHearNetwork: (state: Connection) => void = () => undefined;
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (listener: (state: Connection) => void) => {
    mockHearNetwork = listener;
    listener(mockNetwork);
    return () => undefined;
  },
}));

// One account stays on this phone here, so nothing of what an account leaves behind comes up.
jest.mock('@/features/auth/signIn', () => ({ forgetOtherAccounts: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));

type Supabase = typeof import('@/lib/supabase');

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<Supabase>('@/lib/supabase');
const { AuthProvider } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>('@/features/auth/AuthProvider');
const { useFeedQueue } = jest.requireActual<typeof import('@/features/feeds/api')>('@/features/feeds/api');
const { enqueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');
const { packsKey, useMyPacks } = jest.requireActual<typeof import('@/features/packs/api')>('@/features/packs/api');
const { useAvatarUrls } = jest.requireActual<typeof import('@/features/profile/avatar')>('@/features/profile/avatar');

const MINUTE = 60_000;
const AVATAR = 'dan/me.jpg';
const avatarsKey = ['avatars', AVATAR];
const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };

// auth-js gives a failed refresh half a minute of tries and then waits a minute; here a try takes
// that half minute at once, and the test skips the minute.
const machineNow = Date.now.bind(Date);
let skipped = 0;
const nowSeconds = () => Math.floor(Date.now() / 1000);

let reachable = true;
let readsRefused = false;
const liveTokens = new Set<string>();
const requests: string[] = [];
const tokenCalls = () => requests.filter((path) => path === '/auth/v1/token').length;
const packReads = () => requests.filter((path) => path === '/rest/v1/packs').length;
const feedsSent = () => requests.filter((path) => path === '/rest/v1/rpc/submit_feed').length;

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function server(url: URL, bearer: string | null) {
  if (url.pathname === '/auth/v1/token') {
    const access = `fresh-${tokenCalls()}`;
    liveTokens.add(access);
    return answer(200, {
      access_token: access,
      refresh_token: `refresh-${tokenCalls()}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: nowSeconds() + 3600,
      user: USER,
    });
  }
  const signedIn = liveTokens.has(bearer ?? '');
  // Storage answers whoever asks, and leaves out what they may not see.
  if (url.pathname === '/storage/v1/object/sign/avatars') {
    if (signedIn) return answer(200, [{ path: AVATAR, signedURL: '/object/sign/avatars/link', error: null }]);
    return answer(200, [{ path: AVATAR, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }]);
  }
  if (!signedIn) return answer(401, { code: '42501', message: 'permission denied for table packs' });
  if (readsRefused) return answer(500, { code: 'XX000', message: 'not now' });
  return answer(200, [{ name: 'From the server' }]);
}

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for what the app does in its own time after a render. */
async function until(check: () => Promise<boolean>) {
  for (let tries = 0; tries < 100 && !(await check()); tries += 1) await act(() => settle(20));
}

let sessions = 0;

/** Stores a session whose token dies at that time; auth-js remembers a failed refresh by its token. */
async function storeSession(expires_at: number) {
  sessions += 1;
  const access_token = `old-${sessions}`;
  if (expires_at > nowSeconds()) liveTokens.add(access_token);
  const session = { access_token, refresh_token: `old-refresh-${sessions}`, token_type: 'bearer', expires_in: 3600, expires_at, user: USER };
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

let app: ReactTestRenderer | undefined;

/** Opens the app on what it last had, as the copy on the phone and the memory of a running app do. */
async function openApp(options?: QueryClientConfig['defaultOptions']) {
  // No garbage collection, whose timers would outlive the test.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, ...options?.queries } } });
  client.setQueryData(packsKey, [{ name: 'From the copy' } as Pack]);
  client.setQueryData(avatarsKey, new Map([[AVATAR, 'link from before']]));
  let screen: { packs?: string[]; avatar?: string } = {};

  /** Reads of both kinds: what the server refuses without a token, and what it answers anyway. */
  function Home() {
    useFeedQueue();
    const packs = useMyPacks().data?.map((pack) => pack.name);
    const avatar = useAvatarUrls([AVATAR]).data?.get(AVATAR);
    screen = { packs, avatar };
    return null;
  }

  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Home />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await settle();
  });
  return { client, shown: () => screen };
}

/** Offline with a dead token: the refresh failed and auth-js is waiting before the next one. */
async function openAppOffline(options?: QueryClientConfig['defaultOptions']) {
  reachable = false;
  mockNetwork = { isConnected: false };
  await storeSession(nowSeconds() - 3600);
  return openApp(options);
}

const connectionBack = () =>
  act(async () => {
    reachable = true;
    mockHearNetwork({ isConnected: true });
    await settle();
  });

/** The next run of auth-js's own timer, once its wait is over. */
const refreshRuns = (later = 61_000, wait?: number) =>
  act(async () => {
    skipped += later;
    await requireSupabase().auth.getSession();
    await settle(wait);
  });

beforeAll(() => {
  // auth-js says so on the console each time a refresh can't reach the server.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Date, 'now').mockImplementation(() => machineNow() + skipped);
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (!reachable) {
      if (url.pathname === '/auth/v1/token') skipped += 31_000;
      throw new TypeError('Network request failed');
    }
    return server(url, new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? null);
  }) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
  jest.restoreAllMocks();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  reachable = true;
  readsRefused = false;
  mockNetwork = { isConnected: true };
  liveTokens.clear();
  requests.length = 0;
});

afterEach(async () => {
  await act(async () => app?.unmount());
  app = undefined;
});

describe('a connection back on a good token', () => {
  it('loads right away', async () => {
    await storeSession(nowSeconds() + 3600);
    mockNetwork = { isConnected: false };
    const { shown } = await openApp();
    expect(shown().packs).toEqual(['From the server']);
    expect(packReads()).toBe(1);

    await connectionBack();
    expect(packReads()).toBe(2);
    expect(tokenCalls()).toBe(0);
  });
});

describe('a connection back while auth-js waits after a failed refresh', () => {
  it('keeps what the app had, since the reads go out without a token and are refused', async () => {
    const { shown } = await openAppOffline();
    await connectionBack();
    expect(tokenCalls()).toBe(1);
    expect(shown().packs).toEqual(['From the copy']);
  });

  it('loads as soon as the refresh works', async () => {
    const { shown } = await openAppOffline();
    await connectionBack();
    await refreshRuns();
    expect(tokenCalls()).toBe(2);
    expect(shown().packs).toEqual(['From the server']);
  });

  it('also loads again what the server answered as if to nobody', async () => {
    const { shown } = await openAppOffline();
    await connectionBack();
    expect(shown().avatar).toBeUndefined();
    await refreshRuns();
    expect(shown().avatar).toContain('/object/sign/avatars/link');
  });

  it('does that too when the refused reads are still trying', async () => {
    const { shown } = await openAppOffline({ queries: { retry: 1, retryDelay: 300 } });
    await connectionBack();
    expect(shown().avatar).toBeUndefined();
    await refreshRuns(61_000, 10);
    expect(shown().avatar).toContain('/object/sign/avatars/link');
  });

  it("doesn't go round again when the reload fails", async () => {
    const { shown } = await openAppOffline();
    await connectionBack();
    readsRefused = true;
    await refreshRuns();
    const reads = packReads();
    await act(() => settle(300));
    expect(packReads()).toBe(reads);
    expect(tokenCalls()).toBe(2);
    expect(shown().packs).toEqual(['From the copy']);
  });
});

describe('a feed waiting in the queue', () => {
  const waiting: OutgoingFeed = {
    id: 'a',
    packId: 'pack',
    userId: USER.id,
    photoUri: 'cache/a.jpg',
    caption: null,
    capturedAt: '2026-10-01T10:00:00Z',
    focusMinutes: null,
    extra: false,
  };
  const queueIsEmpty = async () => (await pendingFeeds()).length === 0;

  it('goes out as soon as the refresh works, when the connection came back during the wait', async () => {
    await enqueue(waiting);
    await openAppOffline();
    await connectionBack();
    expect(feedsSent()).toBe(0);

    await refreshRuns();
    await until(queueIsEmpty);
    expect(await pendingFeeds()).toEqual([]);
    expect(feedsSent()).toBe(1);
  });

  it('stays in the queue through a refresh that fails again', async () => {
    await enqueue(waiting);
    await openAppOffline();
    await refreshRuns();
    expect(tokenCalls()).toBe(2);
    expect(feedsSent()).toBe(0);
    expect(await pendingFeeds()).toHaveLength(1);
  });
});

describe('the hourly refresh', () => {
  it('reloads nothing when nothing failed', async () => {
    await storeSession(nowSeconds() + 3600);
    await openApp();
    expect(packReads()).toBe(1);

    await refreshRuns(59 * MINUTE);
    expect(tokenCalls()).toBe(1);
    expect(packReads()).toBe(1);
  });

  it('adds nothing to a read that was already waiting for it', async () => {
    await storeSession(nowSeconds() - 3600);
    await openApp();
    expect(tokenCalls()).toBe(1);
    expect(packReads()).toBe(1);
  });

  it('reloads nothing for a read that failed on a screen long gone', async () => {
    await storeSession(nowSeconds() + 3600);
    const { client } = await openApp();
    await client.fetchQuery({ queryKey: ['gone'], queryFn: () => Promise.reject(new Error('failed')) }).catch(() => undefined);

    await refreshRuns(59 * MINUTE);
    expect(tokenCalls()).toBe(1);
    expect(packReads()).toBe(1);
  });
});
