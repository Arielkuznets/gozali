import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { OutgoingFeed } from '@/features/feeds/send';
import type { Pack } from '@/features/packs/api';

// The real auth-js and the app's own client, auth provider, reads, sign-out, feed queue and widgets,
// against a stand-in for a project that stops serving: restricted or paused, every call comes back
// refused at its gateway, from whoever makes it. Only what is native is replaced. Time is the
// test's, so auth-js's timer and its half a minute of tries run as they do on a phone.
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
    delete() {}
  }
  return { File, Directory, Paths: { document: { uri: 'documents' } } };
});
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
}));

// What the iOS widgets read.
const mockAppGroup = new Map<string, string | undefined>();
jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    static reloadWidget() {}
    set(key: string, value: string | undefined) {
      mockAppGroup.set(key, value);
    }
  },
}));
jest.mock('@/features/widgets/android/task', () => ({ updateAndroidWidgets: async () => undefined }));
jest.mock('expo-notifications', () => ({ setNotificationHandler: () => undefined }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: async () => undefined }));
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');
const { AuthProvider, useAuth } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>(
  '@/features/auth/AuthProvider',
);
const { signOut } = jest.requireActual<typeof import('@/features/auth/signIn')>('@/features/auth/signIn');
const { enqueue, flushQueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');
const { packsKey, useMyPacks } = jest.requireActual<typeof import('@/features/packs/api')>('@/features/packs/api');
const { refreshWidgets, resumeWidgets } = jest.requireActual<typeof import('@/features/widgets/sync')>('@/features/widgets/sync');

const MINUTE = 60_000;
const COPY_KEY = 'gozali.query-cache';
const WIDGET_TOKEN_KEY = 'gozali.widget-token';
const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The status the project answers everything with, while it has stopped serving. */
let stopped: number | null = null;
/** What the project says to a refresh when it is up and turns that refresh down. */
let refreshRefused = false;
/** The name the widgets get for the pack: it changes when the server has something new to show. */
let widgetPack = 'Before';

/** When each access token dies. */
const tokenExpiry = new Map<string, number>();
let tokenRequests: string[] = [];
const refreshes = () => tokenRequests.filter((search) => search === '?grant_type=refresh_token').length;
const savedFeeds: string[] = [];

function answer(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
  });
}

function refusal(status: number) {
  if (status !== 540) {
    return answer(status, {
      message:
        'Service for this project is restricted due to the following violations: exceed_storage_size_quota. The project owner must upgrade their plan or remove spend caps to restore service.',
    });
  }
  return new Response('Project paused', { status, headers: { 'content-type': 'text/plain', date: new Date().toUTCString() } });
}

function server(url: URL, init: RequestInit | undefined) {
  if (url.pathname === '/auth/v1/token') tokenRequests.push(url.search);
  if (stopped !== null) return refusal(stopped);
  if (url.pathname === '/auth/v1/token') {
    if (refreshRefused) return answer(400, { error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' });
    const access_token = `fresh-${tokenRequests.length}`;
    const expires_at = nowSeconds() + 3600;
    tokenExpiry.set(access_token, expires_at);
    return answer(200, {
      access_token,
      refresh_token: `fresh-refresh-${tokenRequests.length}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at,
      user: USER,
    });
  }
  if (url.pathname === '/functions/v1/widget-state') {
    return answer(200, { timezone: 'Asia/Jerusalem', fetchedAt: new Date().toISOString(), packs: [{ id: 'pack', name: widgetPack }] });
  }
  const bearer = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  const alive = (tokenExpiry.get(bearer) ?? 0) > nowSeconds();
  if (url.pathname.startsWith('/storage/v1/object/')) {
    if (!alive) return answer(400, { statusCode: '403', error: 'Unauthorized', message: '"exp" claim timestamp check failed' });
    return answer(200, { Id: 'object', Key: url.pathname });
  }
  if (!alive) return answer(401, { code: '42501', message: 'permission denied for table packs' });
  if (url.pathname === '/rest/v1/rpc/create_widget_token') return answer(200, 'noa-widget-token');
  if (url.pathname === '/rest/v1/rpc/submit_feed') {
    savedFeeds.push(String(init?.body));
    return answer(200, 'feed-id');
  }
  return answer(200, [{ name: 'From the server' }]);
}

let sessions = 0;

/** Stores a session whose token dies at that time; auth-js remembers a failed refresh by its token. */
async function storeSession(expires_at: number) {
  sessions += 1;
  const access_token = `old-${sessions}`;
  tokenExpiry.set(access_token, expires_at);
  const session = { access_token, refresh_token: `old-refresh-${sessions}`, token_type: 'bearer', expires_in: 3600, expires_at, user: USER };
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

const storedAccount = async () => {
  const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
  return stored ? (JSON.parse(stored) as Session).user.id : null;
};

/** A phone after everyday use: widgets up and the packs kept, with a session that dies at that time. */
async function phoneInUse(expires_at: number) {
  await storeSession(nowSeconds() + 3600);
  await refreshWidgets();
  await AsyncStorage.setItem(COPY_KEY, JSON.stringify({ kept: true }));
  await storeSession(expires_at);
}

const widgetsShow = () => {
  const { packs } = JSON.parse(mockAppGroup.get('snapshot') ?? '{ "packs": [] }') as { packs: { name: string }[] };
  return packs.map(({ name }) => name);
};

const feed: OutgoingFeed = {
  id: 'waiting',
  packId: 'pack',
  userId: 'noa',
  photoUri: 'cache/waiting.jpg',
  caption: null,
  capturedAt: '2026-11-01T20:00:00Z',
  focusMinutes: null,
  extra: false,
};
const waiting = async () => (await pendingFeeds()).map((item) => item.id);

/** Lets the app run for that long. */
const wait = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

/** Lets the app run until the work is done. */
async function passing<T>(work: Promise<T>): Promise<T> {
  let done = false;
  const finishing = work.finally(() => {
    done = true;
  });
  await act(async () => {
    while (!done) await jest.advanceTimersByTimeAsync(1000);
  });
  return finishing;
}

let app: ReactTestRenderer | undefined;

/** Opens the app on what it last had, as the copy on the phone and the memory of a running app do. */
async function openApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(packsKey, [{ name: 'From the copy' } as Pack]);
  let screen: { signedIn?: string; packs?: string[] } = {};
  function Home() {
    const { session } = useAuth();
    const packs = useMyPacks().data?.map((pack) => pack.name);
    screen = { signedIn: session?.user.id, packs };
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
  });
  return () => screen;
}

/** What the app heard about the session, in order. */
let events: string[] = [];
let stopListening = () => {};

beforeAll(async () => {
  // auth-js says so on the console each time a refresh can't reach the server.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => server(new URL(String(input)), init)) as unknown as typeof fetch;
  // The client's own start finishes first, so each test's refresh is the one the app hears about.
  await requireSupabase().auth.getSession();
  await requireSupabase().auth.stopAutoRefresh();
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  await AsyncStorage.clear();
  mockAppGroup.clear();
  stopped = null;
  refreshRefused = false;
  widgetPack = 'Before';
  tokenExpiry.clear();
  tokenRequests = [];
  savedFeeds.length = 0;
  events = [];
  resumeWidgets();
  const { data } = requireSupabase().auth.onAuthStateChange((event) => {
    events.push(event);
  });
  stopListening = () => data.subscription.unsubscribe();
  await requireSupabase().auth.startAutoRefresh();
});

afterEach(async () => {
  await act(async () => app?.unmount());
  app = undefined;
  stopListening();
  await requireSupabase().auth.stopAutoRefresh();
  jest.useRealTimers();
});

describe.each([
  ['restricted', 402],
  ['paused', 540],
])('a project %s, answering %i to everything', (_state, status) => {
  describe('on opening the app with the token run out', () => {
    it('keeps the person on their packs, with the copy and the widgets', async () => {
      await phoneInUse(nowSeconds() - 600);
      stopped = status;
      const shown = await openApp();
      await wait(MINUTE / 2);

      expect(events).not.toContain('SIGNED_OUT');
      expect(await storedAccount()).toBe('noa');
      expect(shown()).toEqual({ signedIn: 'noa', packs: ['From the copy'] });
      expect(await AsyncStorage.getItem(COPY_KEY)).not.toBeNull();
      expect(widgetsShow()).toEqual(['Before']);
      expect(await AsyncStorage.getItem(WIDGET_TOKEN_KEY)).toBe('noa-widget-token');
      expect(refreshes()).toBeGreaterThan(1);
    });

    it('loads from the server by itself once the project is back', async () => {
      await phoneInUse(nowSeconds() - 600);
      stopped = status;
      const shown = await openApp();
      await wait(MINUTE / 2);

      stopped = null;
      await wait(1.5 * MINUTE);
      expect(shown()).toEqual({ signedIn: 'noa', packs: ['From the server'] });
    });

    it('still hears it once the project is back, if the server ended the session meanwhile', async () => {
      await phoneInUse(nowSeconds() - 600);
      stopped = status;
      const shown = await openApp();
      await wait(MINUTE / 2);

      stopped = null;
      refreshRefused = true;
      await wait(1.5 * MINUTE);
      expect(events).toContain('SIGNED_OUT');
      expect(await storedAccount()).toBeNull();
      expect(shown().signedIn).toBeUndefined();
    });
  });

  describe('with the app left open as the token runs out', () => {
    it('keeps the person on their packs, with the copy and the widgets', async () => {
      await phoneInUse(nowSeconds() + 300);
      const shown = await openApp();
      await wait(1000);
      expect(shown()).toEqual({ signedIn: 'noa', packs: ['From the server'] });

      stopped = status;
      await wait(7 * MINUTE);

      expect(events).not.toContain('SIGNED_OUT');
      expect(await storedAccount()).toBe('noa');
      expect(shown()).toEqual({ signedIn: 'noa', packs: ['From the server'] });
      expect(await AsyncStorage.getItem(COPY_KEY)).not.toBeNull();
      expect(widgetsShow()).toEqual(['Before']);
    });
  });

  describe('with a token still good', () => {
    it('goes on with that token after one try', async () => {
      await storeSession(nowSeconds() + 30);
      stopped = status;
      const { data, error } = await requireSupabase().auth.getSession();

      expect(error).toBeNull();
      expect(data.session?.access_token).toMatch(/^old-/);
      expect(refreshes()).toBe(1);
    });
  });

  describe('the widgets', () => {
    it('stay on their last picture, and catch up once the project is back', async () => {
      await phoneInUse(nowSeconds() + 3600);
      stopped = status;
      widgetPack = 'After';
      await refreshWidgets();
      expect(widgetsShow()).toEqual(['Before']);

      stopped = null;
      await refreshWidgets();
      expect(widgetsShow()).toEqual(['After']);
    });
  });

  describe('a queued feed', () => {
    it('waits through a token run out, and goes out once the project is back', async () => {
      await storeSession(nowSeconds() - 600);
      await enqueue(feed);
      stopped = status;
      const during = await passing(flushQueue());
      expect(during).toMatchObject({ handled: 0, dropped: [] });
      expect(await waiting()).toEqual(['waiting']);

      stopped = null;
      await wait(1.5 * MINUTE);
      const after = await passing(flushQueue());
      expect(after).toMatchObject({ handled: 1, dropped: [] });
      expect(savedFeeds).toHaveLength(1);
      expect(await waiting()).toEqual([]);
    });

    it('waits on a token still good, and goes out once the project is back', async () => {
      await storeSession(nowSeconds() + 3600);
      await enqueue(feed);
      stopped = status;
      expect(await flushQueue()).toMatchObject({ handled: 0, dropped: [] });
      expect(await waiting()).toEqual(['waiting']);

      stopped = null;
      expect(await flushQueue()).toMatchObject({ handled: 1, dropped: [] });
      expect(savedFeeds).toHaveLength(1);
    });
  });

  describe('signing out with the token run out', () => {
    it('fails as it does offline, and leaves the person signed in with their feeds', async () => {
      await phoneInUse(nowSeconds() - 600);
      await enqueue(feed);
      stopped = status;
      const shown = await openApp();
      const outcome = signOut().then(
        () => 'signed out',
        () => 'failed',
      );

      expect(await passing(outcome)).toBe('failed');
      expect(await storedAccount()).toBe('noa');
      expect(shown().signedIn).toBe('noa');
      expect(await waiting()).toEqual(['waiting']);
      expect(widgetsShow()).toEqual(['Before']);
      expect(await AsyncStorage.getItem(WIDGET_TOKEN_KEY)).toBe('noa-widget-token');
    });
  });
});

describe('a refresh the server itself turns down', () => {
  it('still ends the session and takes the copy and the widgets with it', async () => {
    await phoneInUse(nowSeconds() - 600);
    refreshRefused = true;
    const shown = await openApp();
    await wait(1000);

    expect(events).toContain('SIGNED_OUT');
    expect(await storedAccount()).toBeNull();
    expect(shown().signedIn).toBeUndefined();
    expect(await AsyncStorage.getItem(COPY_KEY)).toBeNull();
    expect(widgetsShow()).toEqual([]);
  });
});

describe('a sign-in on a restricted project', () => {
  it('answers with the refusal after one try', async () => {
    stopped = 402;
    const { error } = await requireSupabase().auth.signInWithIdToken({ provider: 'apple', token: 'apple-token' });

    expect(error).toMatchObject({ name: 'AuthApiError', status: 402 });
    expect(isAuthRetryableFetchError(error)).toBe(false);
    expect(tokenRequests).toEqual(['?grant_type=id_token']);
  });
});
