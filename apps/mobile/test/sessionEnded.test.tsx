import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { OutgoingFeed } from '@/features/feeds/send';

// The real auth-js and the app's own client, auth provider, sign-out, widgets, queue and focus
// timer, against a stand-in for the server. Only what is native is replaced.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

// Files are just names here, as in the queue test.
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    async copy() {}
    delete() {
      mockDeleted.push(this.uri);
    }
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

// What the iOS widgets read, and how often they were told to redraw.
const mockAppGroup = new Map<string, string | undefined>();
const mockRedraw = jest.fn();
jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    static reloadWidget() {
      mockRedraw();
    }
    set(key: string, value: string | undefined) {
      mockAppGroup.set(key, value);
    }
  },
}));
jest.mock('@/features/widgets/android/task', () => ({ updateAndroidWidgets: async () => undefined }));

const mockCancelled: string[] = [];
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  cancelScheduledNotificationAsync: async (id: string) => {
    mockCancelled.push(id);
  },
}));
const mockClearNotifications = jest.fn(async () => undefined);
jest.mock('@/lib/notifications', () => ({ clearNotifications: () => mockClearNotifications() }));
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));

type Supabase = typeof import('@/lib/supabase');

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<Supabase>('@/lib/supabase');
const { AuthProvider } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>('@/features/auth/AuthProvider');
const { signOut } = jest.requireActual<typeof import('@/features/auth/signIn')>('@/features/auth/signIn');
const { enqueue, flushQueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');
const { refreshWidgets, resumeWidgets } = jest.requireActual<typeof import('@/features/widgets/sync')>('@/features/widgets/sync');

const FOCUS_KEY = 'gozali.focus';
const TOKEN_KEY = 'gozali.widget-token';
const SNAPSHOT_KEY = 'gozali.widget-snapshot';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const accountOf = (id: string) => ({
  id,
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-10-01T00:00:00Z',
});

let sessions = 0;

/** A session for the account; auth-js remembers a refused refresh by its token, so each is new. */
function sessionOf(id: string, expires_at: number) {
  sessions += 1;
  return {
    access_token: `${id}-access`,
    refresh_token: `${id}-refresh-${sessions}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at,
    user: accountOf(id),
  };
}

/** Each request the server took, as "method path by whoever the token says". */
const requests: string[] = [];
const requested = (what: string) => requests.filter((request) => request.includes(what));
/** The feeds that reached the server. */
const savedFeeds: string[] = [];

function reply(status: number, body?: unknown) {
  const headers = { 'content-type': 'application/json', date: new Date().toUTCString() };
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

/** The widget state of an account, whose token says whose it is. */
const widgetState = (id: string) => ({
  timezone: 'Asia/Jerusalem',
  fetchedAt: new Date().toISOString(),
  packs: [{ id: `${id}-pack`, name: `${id}'s pack` }],
});

function server(url: URL, init: RequestInit | undefined) {
  const bearer = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  const caller = bearer.endsWith('-access') ? bearer.replace('-access', '') : null;
  requests.push(`${init?.method ?? 'GET'} ${url.pathname} by ${caller}`);

  if (url.pathname === '/auth/v1/token') {
    // Every refresh token here is one the server has revoked.
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    }
    const { email } = JSON.parse(String(init?.body)) as { email: string };
    return reply(200, sessionOf(email.split('@')[0]!, nowSeconds() + 3600));
  }
  if (url.pathname === '/auth/v1/logout') return reply(204);
  if (url.pathname === '/functions/v1/widget-state') {
    const token = new Headers(init?.headers).get('x-widget-token') ?? '';
    return reply(200, widgetState(token.split('-')[0]!));
  }
  if (url.pathname.startsWith('/storage/v1/object/')) {
    // Row level security: a photo goes into its owner's folder only.
    if (caller === null || !url.pathname.includes(`/${caller}/`)) {
      return reply(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    }
    return reply(200, { Id: 'object', Key: url.pathname });
  }
  if (caller === null) return reply(401, { code: '42501', message: 'permission denied' });
  if (url.pathname === '/rest/v1/rpc/create_widget_token') return reply(200, `${caller}-widget-token`);
  if (url.pathname === '/rest/v1/rpc/submit_feed') {
    savedFeeds.push(String(init?.body));
    return reply(200, 'feed-id');
  }
  return reply(204);
}

const feed = (id: string, userId: string): OutgoingFeed => ({
  id,
  packId: 'pack',
  userId,
  photoUri: `cache/${id}.jpg`,
  caption: null,
  capturedAt: '2026-10-29T20:00:00Z',
  focusMinutes: null,
  extra: false,
});

const focusSession = {
  packId: 'pack',
  minutes: 25,
  startedAt: 1,
  pausedAt: null,
  pausedMs: 0,
  notificationId: 'end-of-focus',
};

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const waiting = async () => (await pendingFeeds()).map((item) => item.id);

let app: ReactTestRenderer | undefined;

/** The app open on the account's packs, with widgets, a queued feed and a running focus timer. */
async function openAppAs(id: string) {
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(id, nowSeconds() + 3600)));
  resumeWidgets();
  await refreshWidgets();
  await enqueue(feed('waiting', id));
  await AsyncStorage.setItem(FOCUS_KEY, JSON.stringify(focusSession));
  await act(async () => {
    app = create(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>{null}</AuthProvider>
      </QueryClientProvider>,
    );
    await settle();
  });
  requests.length = 0;
  mockRedraw.mockClear();
  mockCancelled.length = 0;
}

/** The server ended the session: the token ran out and the refresh comes back refused. */
async function serverEndsSession(id: string) {
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(id, nowSeconds() - 120)));
  await act(async () => {
    await requireSupabase().auth.getSession();
    await settle();
  });
}

async function signInAs(id: string) {
  await act(async () => {
    const { error } = await requireSupabase().auth.signInWithPassword({ email: `${id}@gozali.test`, password: 'password' });
    if (error) throw error;
    await settle();
  });
  // The app's screens for an account opening, which let the widgets refresh.
  resumeWidgets();
}

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => server(new URL(String(input)), init)) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAppGroup.clear();
  mockDeleted.length = 0;
  savedFeeds.length = 0;
  requests.length = 0;
  mockClearNotifications.mockClear();
});

afterEach(async () => {
  await act(async () => app?.unmount());
  app = undefined;
});

describe('a session the server ended, with nobody signing out', () => {
  beforeEach(async () => {
    await openAppAs('alice');
    await serverEndsSession('alice');
  });

  it('takes the account off the widgets', async () => {
    expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    expect(mockAppGroup.get('snapshot')).toBeUndefined();
    expect(mockAppGroup.get('token')).toBeUndefined();
    expect(mockRedraw).toHaveBeenCalled();
  });

  it('keeps the feeds and the focus timer in case the same person comes back', async () => {
    expect(await waiting()).toEqual(['waiting']);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockCancelled).toEqual([]);
  });

  it('hands them back to that person, and the feed goes out', async () => {
    await signInAs('alice');

    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockClearNotifications).not.toHaveBeenCalled();
    expect((await flushQueue()).handled).toBe(1);
    expect(savedFeeds).toHaveLength(1);
  });

  it('forgets them when someone else signs in, and the next account sends nothing of theirs', async () => {
    await signInAs('bob');

    expect(await waiting()).toEqual([]);
    expect(mockDeleted).toEqual(['documents/feed-queue/waiting.jpg']);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).toBeNull();
    expect(mockCancelled).toEqual(['end-of-focus']);
    expect(mockClearNotifications).toHaveBeenCalledTimes(1);
    expect((await flushQueue()).handled).toBe(0);
    expect(requested('/storage/v1/object/')).toEqual([]);
  });

  it('shows the next account its own packs, with a token of its own', async () => {
    await signInAs('bob');
    await refreshWidgets();

    expect(requested('create_widget_token')).toEqual(['POST /rest/v1/rpc/create_widget_token by bob']);
    expect(JSON.parse(mockAppGroup.get('snapshot')!).packs.map((pack: { name: string }) => pack.name)).toEqual(["bob's pack"]);
    expect(mockAppGroup.get('token')).toBe('bob-widget-token');
  });
});

describe('another account finding what a session left behind', () => {
  beforeEach(async () => {
    await openAppAs('alice');
    // Nothing took them away: the phone holds what the last session left as it was.
    await act(async () => app?.unmount());
    app = undefined;
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf('bob', nowSeconds() + 3600)));
    resumeWidgets();
  });

  it('gets a token of its own instead of the one left there', async () => {
    await refreshWidgets();

    expect(requested('create_widget_token')).toEqual(['POST /rest/v1/rpc/create_widget_token by bob']);
    expect(mockAppGroup.get('token')).toBe('bob-widget-token');
    expect(mockAppGroup.get('snapshot')).toContain("bob's pack");
  });

  it("doesn't send the feed left there", async () => {
    await expect(flushQueue()).resolves.toEqual({ handled: 0, dropped: [], stuck: [] });
    expect(requested('/storage/v1/object/')).toEqual([]);
    expect(await waiting()).toEqual(['waiting']);
  });
});

describe('a phone that has no last account on record', () => {
  it("takes what it holds to be the signed-in account's", async () => {
    await openAppAs('alice');

    expect(await waiting()).toEqual(['waiting']);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockClearNotifications).not.toHaveBeenCalled();
  });
});

describe('signing out in the app', () => {
  beforeEach(() => openAppAs('alice'));

  it('takes its usual path: the token revoked with the session, one redraw, everything forgotten', async () => {
    await act(async () => {
      await signOut();
      await settle();
    });

    expect(requests).toEqual([
      'POST /rest/v1/rpc/revoke_widget_token by alice',
      'POST /auth/v1/logout by alice',
    ]);
    expect(mockRedraw).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    expect(await waiting()).toEqual([]);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).toBeNull();
    expect(mockCancelled).toEqual(['end-of-focus']);
    expect(mockClearNotifications).toHaveBeenCalledTimes(1);
  });

  it('leaves the next account nothing to clear', async () => {
    await act(async () => {
      await signOut();
      await settle();
    });
    mockClearNotifications.mockClear();
    requests.length = 0;

    await signInAs('bob');
    await refreshWidgets();

    expect(requests).toEqual([
      'POST /auth/v1/token by null',
      'POST /rest/v1/rpc/create_widget_token by bob',
      'GET /functions/v1/widget-state by null',
    ]);
    expect(mockAppGroup.get('token')).toBe('bob-widget-token');
  });
});
