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
  addEventListener: () => () => undefined,
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
  dismissNotificationAsync: async () => undefined,
}));
const mockClearNotifications = jest.fn(async () => undefined);
jest.mock('@/lib/notifications', () => ({
  askForNotificationsOnce: async () => undefined,
  clearNotifications: () => mockClearNotifications(),
}));
jest.mock('@/lib/push', () => ({ registerPushToken: async () => undefined, unregisterPushToken: async () => undefined }));

type Supabase = typeof import('@/lib/supabase');

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<Supabase>('@/lib/supabase');
const { AuthProvider, useAuth } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>('@/features/auth/AuthProvider');
const { signOut } = jest.requireActual<typeof import('@/features/auth/signIn')>('@/features/auth/signIn');
const { enqueue, flushQueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');
const { isProfileComplete, useAccountSync, useProfile } = jest.requireActual<typeof import('@/features/profile/useProfile')>(
  '@/features/profile/useProfile',
);
const { suggestName, suggestedName } = jest.requireActual<typeof import('@/features/profile/suggestedName')>('@/features/profile/suggestedName');
const { deviceTimeZone } = jest.requireActual<typeof import('@/lib/dates')>('@/lib/dates');
const { refreshWidgets, resumeWidgets } = jest.requireActual<typeof import('@/features/widgets/sync')>('@/features/widgets/sync');

const FOCUS_KEY = 'gozali.focus';
const LAST_ACCOUNT_KEY = 'gozali.last-account';
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
/** Accounts that haven't been through the profile setup. */
const unfinished = new Set<string>();

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
  if (url.pathname === '/rest/v1/profiles') {
    const done = !unfinished.has(caller ?? '');
    return reply(200, {
      id: caller,
      display_name: done ? caller : null,
      terms_accepted_at: done ? '2026-10-01T00:00:00Z' : null,
      timezone: deviceTimeZone(),
    });
  }
  requests.push(`${init?.method ?? 'GET'} ${url.pathname} by ${caller}`);

  if (url.pathname === '/auth/v1/token') {
    // Every refresh token here is one the server has revoked.
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    }
    if (url.searchParams.get('grant_type') === 'id_token') return reply(400, { error_code: 'bad_jwt', msg: 'Bad ID token' });
    const { email } = JSON.parse(String(init?.body)) as { email: string };
    return reply(200, sessionOf(email.split('@')[0]!, nowSeconds() + 3600));
  }
  if (url.pathname === '/auth/v1/logout') return reply(204);
  if (url.pathname === '/functions/v1/widget-state') {
    const token = new Headers(init?.headers).get('x-widget-token') ?? '';
    return reply(200, widgetState(token.split('-')[0]!));
  }
  if (url.pathname.startsWith('/storage/v1/object/')) {
    // Storage's answer when the photo isn't there, which it never is before its upload here.
    if (init?.method === 'HEAD') return reply(400, {});
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

/** Long enough for what the session changed to reach the screens, and for what they start to finish. */
async function settleScreens() {
  for (let step = 0; step < 5; step += 1) {
    await act(async () => {
      await settle(10);
    });
  }
}

function AppScreens() {
  useAccountSync();
  return null;
}

/** The guards of the root layout: the app's screens are for an account past the profile setup. */
function Guards() {
  const { session } = useAuth();
  const { data: profile } = useProfile();
  return session && isProfileComplete(profile) ? <AppScreens /> : null;
}

let client: QueryClient | undefined;
let app: ReactTestRenderer | undefined;

/** The app open on the account's packs, with widgets, a queued feed and a running focus timer. */
async function openAppAs(id: string) {
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(id, nowSeconds() + 3600)));
  resumeWidgets();
  await refreshWidgets();
  await enqueue(feed('waiting', id));
  await AsyncStorage.setItem(FOCUS_KEY, JSON.stringify(focusSession));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => {
    app = create(
      <QueryClientProvider client={client!}>
        <AuthProvider>
          <Guards />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await settle();
  });
  await settleScreens();
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
  await settleScreens();
  // The app's screens for an account opening, which let the widgets refresh.
  resumeWidgets();
}

async function signOutHere() {
  await act(async () => {
    await signOut();
    await settle();
  });
  await settleScreens();
}

/** The account finishes the profile setup, or the developer sends it back there. */
async function profileChanges() {
  await act(async () => {
    await client?.invalidateQueries();
    await settle();
  });
  await settleScreens();
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
  unfinished.clear();
  mockClearNotifications.mockClear();
});

afterEach(async () => {
  await act(async () => app?.unmount());
  app = undefined;
  client?.clear();
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
    expect(mockCancelled).toEqual(['end-of-focus', 'gozali.focus-end']);
    expect(mockClearNotifications).toHaveBeenCalled();
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

describe('the wrong account, between a session the server ended and the same person coming back', () => {
  beforeEach(async () => {
    await openAppAs('alice');
    await serverEndsSession('alice');
    unfinished.add('work-id');
  });

  it('leaves the feeds and the focus timer alone while it is on the profile setup', async () => {
    await signInAs('work-id');

    expect(await waiting()).toEqual(['waiting']);
    expect(mockDeleted).toEqual([]);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockCancelled).toEqual([]);
  });

  it('takes the notifications off the phone: a tap on one would open packs that are not theirs', async () => {
    await signInAs('work-id');

    expect(mockClearNotifications).toHaveBeenCalled();
  });

  it('sends nothing of theirs while it is on the profile setup', async () => {
    await signInAs('work-id');

    expect((await flushQueue()).handled).toBe(0);
    expect(requested('/storage/v1/object/')).toEqual([]);
    expect(await waiting()).toEqual(['waiting']);
  });

  it('hands them back when it signs out on the setup and the right account signs in', async () => {
    await signInAs('work-id');
    await signOutHere();

    expect(await waiting()).toEqual(['waiting']);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockCancelled).toEqual([]);

    await signInAs('alice');

    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockCancelled).toEqual([]);
    expect((await flushQueue()).handled).toBe(1);
    expect(savedFeeds).toHaveLength(1);
  });

  it('forgets them once it finishes the setup and reaches the app', async () => {
    await signInAs('work-id');
    unfinished.clear();
    await profileChanges();

    expect(await waiting()).toEqual([]);
    expect(mockDeleted).toEqual(['documents/feed-queue/waiting.jpg']);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).toBeNull();
    expect(mockCancelled).toEqual(['end-of-focus', 'gozali.focus-end']);
  });

  it('takes along what it had waiting itself, and only that', async () => {
    await signInAs('work-id');
    await enqueue(feed('its-own', 'work-id'));
    await signOutHere();

    expect(await waiting()).toEqual(['waiting']);
    expect(mockDeleted).toEqual(['documents/feed-queue/its-own.jpg']);
  });
});

describe('an account sent back to the profile setup, with work of its own waiting', () => {
  it('forgets all of it on Sign out, as anywhere else', async () => {
    await openAppAs('alice');
    unfinished.add('alice');
    await profileChanges();
    await signOutHere();

    expect(await waiting()).toEqual([]);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).toBeNull();
    expect(mockCancelled).toEqual(['end-of-focus', 'gozali.focus-end']);
    expect(mockClearNotifications).toHaveBeenCalled();
  });
});

describe('a phone from before there was a last account on record, nobody signed in', () => {
  beforeEach(async () => {
    await openAppAs('alice');
    await serverEndsSession('alice');
    await AsyncStorage.removeItem(LAST_ACCOUNT_KEY);
  });

  it('hands it all back to the same person', async () => {
    await signInAs('alice');

    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockClearNotifications).not.toHaveBeenCalled();
    expect((await flushQueue()).handled).toBe(1);
  });

  it('keeps the feeds from another account on the profile setup, as they say whose they are', async () => {
    unfinished.add('work-id');
    await signInAs('work-id');
    await signOutHere();

    expect(await waiting()).toEqual(['waiting']);
    await signInAs('alice');
    expect((await flushQueue()).handled).toBe(1);
  });

  it('forgets the feeds when another account reaches the app', async () => {
    await signInAs('bob');

    expect(await waiting()).toEqual([]);
  });

  it('notes who reached the app, so the next account is told apart', async () => {
    await signInAs('bob');

    expect(await AsyncStorage.getItem(LAST_ACCOUNT_KEY)).toBe('bob');
  });
});

describe('the name the sign-in provider gave', () => {
  beforeEach(() => openAppAs('noa'));

  it('goes with a session the server ended, so the next account is not offered it', async () => {
    suggestName('Noa Levi');

    await serverEndsSession('noa');

    expect(suggestedName()).toBeNull();
  });

  it('stays through a sign-in that failed, for the try after it, which comes without it', async () => {
    await serverEndsSession('noa');
    suggestName('Noa Levi');

    const { error } = await requireSupabase().auth.signInWithIdToken({ provider: 'apple', token: 'apple-token' });
    await settleScreens();

    expect(error).not.toBeNull();
    expect(suggestedName()).toBe('Noa Levi');
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
    await expect(flushQueue()).resolves.toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
    expect(requested('/storage/v1/object/')).toEqual([]);
    expect(await waiting()).toEqual(['waiting']);
  });
});

describe('a phone that has no last account on record', () => {
  it("takes what it holds to be the signed-in account's, and starts the record", async () => {
    await openAppAs('alice');

    expect(await waiting()).toEqual(['waiting']);
    expect(await AsyncStorage.getItem(FOCUS_KEY)).not.toBeNull();
    expect(mockClearNotifications).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LAST_ACCOUNT_KEY)).toBe('alice');
  });

  it('leaves no record for an account that stays on the profile setup', async () => {
    unfinished.add('alice');
    await openAppAs('alice');

    expect(await AsyncStorage.getItem(LAST_ACCOUNT_KEY)).toBeNull();
    expect(await waiting()).toEqual(['waiting']);
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
    expect(mockCancelled).toEqual(['end-of-focus', 'gozali.focus-end']);
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
