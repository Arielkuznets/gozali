import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { OutgoingFeed } from '@/features/feeds/send';

// The real supabase-js and the app's own client, hooks and queue, against a stand-in for a server
// that takes a request and never answers it. Such a request ends only when it is aborted, as on a
// connection that died quietly. Only what is native is replaced.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

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
  addEventListener: () => () => undefined,
}));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: async () => undefined }));
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');
const { usePack } = jest.requireActual<typeof import('@/features/packs/api')>('@/features/packs/api');
const { usePackFeed } = jest.requireActual<typeof import('@/features/feeds/api')>('@/features/feeds/api');
const { enqueue, flushQueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');
const { useDayPass } = jest.requireActual<typeof import('@/features/days/api')>('@/features/days/api');
const { useBuy, useNudge } = jest.requireActual<typeof import('@/features/social/api')>('@/features/social/api');
const { deleteAccount } = jest.requireActual<typeof import('@/features/auth/signIn')>('@/features/auth/signIn');
// What expo/fetch rejects with on a phone when a request is aborted.
const { FetchError } = jest.requireActual<typeof import('expo/src/winter/fetch/FetchErrors')>('expo/src/winter/fetch/FetchErrors');

const UPLOAD = '/storage/v1/object/feed-photos/';
const SUBMIT = '/rest/v1/rpc/submit_feed';
const nowSeconds = () => Math.floor(Date.now() / 1000);

let sessions = 0;

/** A session; auth-js remembers a failed refresh by its token, so each is new. */
function sessionOf(expires_at: number) {
  sessions += 1;
  return {
    access_token: 'noa-access',
    refresh_token: `noa-refresh-${sessions}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at,
    user: { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
  };
}

/** Each request the server took, as "method path by who". */
const requests: string[] = [];
const requested = (what: string) => requests.filter((request) => request.includes(what)).length;
/** What is on the server: the photos, and the feed saved for each photo. */
const photos = new Set<string>();
const feeds = new Map<string, string>();
let accountGone = false;
/** The server does the work of these, but no answer comes back. */
let unanswered: (url: URL) => boolean = () => false;

/** Only the first of these goes unanswered: the connection comes back behind it. */
function firstOf(path: string) {
  let gone = false;
  return (url: URL) => {
    if (gone || !url.pathname.startsWith(path)) return false;
    gone = true;
    return true;
  };
}

function reply(status: number, body?: unknown) {
  const headers = { 'content-type': 'application/json', date: new Date().toUTCString() };
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function server(url: URL, init: RequestInit | undefined, caller: string | null) {
  const path = url.pathname;
  if (path === '/auth/v1/token') return reply(200, sessionOf(nowSeconds() + 3600));
  if (path === '/auth/v1/user') {
    return accountGone ? reply(404, { error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }) : reply(200, sessionOf(0).user);
  }
  if (path === '/auth/v1/logout') return reply(204);
  // What the API says to a request that went out without the user's token.
  if (caller === null) return reply(401, { code: '42501', details: null, hint: null, message: 'permission denied' });
  if (path === '/functions/v1/delete-account') {
    // The function turns down the token of an account that is gone.
    if (accountGone) return new Response('not signed in', { status: 401 });
    accountGone = true;
    return reply(200, { deleted: true, photos: 0 });
  }
  if (path === '/rest/v1/packs') return reply(200, { id: 'pack', name: 'Gym squad', timezone: 'UTC', pack_members: [], critters: null });
  if (path === '/rest/v1/feeds') return reply(200, []);
  if (path.startsWith(UPLOAD)) {
    if (photos.has(path)) return reply(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    photos.add(path);
    return reply(200, { Id: 'object', Key: path });
  }
  if (path === SUBMIT) {
    const { photo } = JSON.parse(String(init?.body)) as { photo: string };
    if (!feeds.has(photo)) feeds.set(photo, `feed-${feeds.size + 1}`);
    return reply(200, feeds.get(photo));
  }
  return reply(200, []);
}

const feed = (id: string): OutgoingFeed => ({
  id,
  packId: 'pack',
  userId: 'noa',
  photoUri: `cache/${id}.jpg`,
  caption: null,
  capturedAt: '2026-11-01T09:00:00Z',
  focusMinutes: null,
  extra: false,
});

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

let app: ReactTestRenderer | undefined;
let client: QueryClient;

async function open(Screen: ComponentType) {
  // No garbage collection, whose timers would outlive the test.
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <Screen />
      </QueryClientProvider>,
    );
  });
}

beforeAll(() => {
  globalThis.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const bearer = new Headers(init?.headers).get('authorization') ?? '';
    const caller = bearer.endsWith('-access') ? 'noa' : null;
    requests.push(`${init?.method ?? 'GET'} ${url.pathname} by ${caller}`);
    const answer = server(url, init, caller);
    if (!unanswered(url)) return Promise.resolve(answer);
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new FetchError('Fetch request has been canceled')));
    });
  }) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
});

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
  await AsyncStorage.clear();
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() + 3600)));
  requests.length = 0;
  photos.clear();
  feeds.clear();
  accountGone = false;
  unanswered = () => false;
});

afterEach(async () => {
  await act(async () => app?.unmount());
  app = undefined;
  client?.clear();
  jest.useRealTimers();
});

describe('a read with no answer', () => {
  it('asks again by itself, with something on screen', async () => {
    function Pack() {
      usePack('pack');
      return null;
    }
    await open(Pack);
    await advance(1_000);
    expect(requested('/rest/v1/packs')).toBe(1);

    unanswered = firstOf('/rest/v1/packs');
    await act(async () => {
      void client.invalidateQueries();
    });
    await advance(60_000);

    expect(requested('/rest/v1/packs')).toBe(3);
    expect(client.getQueryState(['packs', 'pack'])?.fetchStatus).toBe('idle');
  });

  it('asks again by itself on a first load, and the screen fills in', async () => {
    function Photos() {
      usePackFeed('pack', 30);
      return null;
    }
    unanswered = firstOf('/rest/v1/feeds');
    await open(Photos);
    await advance(60_000);

    expect(requested('/rest/v1/feeds')).toBe(2);
    expect(client.getQueryState(['feeds', 'pack', 'pack', 30])?.status).toBe('success');
  });

  it('reaches the error a screen can offer Try again on, when nothing answers', async () => {
    function Photos() {
      usePackFeed('pack', 30);
      return null;
    }
    unanswered = () => true;
    await open(Photos);
    await advance(126_000);
    expect(client.getQueryState(['feeds', 'pack', 'pack', 30])?.status).toBe('pending');

    await advance(2_000);
    expect(client.getQueryState(['feeds', 'pack', 'pack', 30])?.status).toBe('error');
    expect(requested('/rest/v1/feeds')).toBe(4);
  });
});

describe('a token refresh with no answer', () => {
  it('lets the requests behind it go, and the next one goes out as the member', async () => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() - 60)));
    unanswered = firstOf('/auth/v1/token');
    let answered = 0;
    const read = () =>
      void requireSupabase()
        .from('packs')
        .select('id')
        .then(() => {
          answered += 1;
        });

    read();
    read();
    read();
    await advance(60_000);
    expect(requested('/auth/v1/token')).toBe(1);
    expect(answered).toBe(3);

    await advance(60_000);
    read();
    await advance(1_000);
    expect(answered).toBe(4);
    expect(requested('/auth/v1/token')).toBe(2);
    expect(requested('/rest/v1/packs by noa')).toBe(1);
  });
});

describe('a queued feed', () => {
  async function run() {
    const outcome: { handled?: number } = {};
    void flushQueue().then(({ handled }) => {
      outcome.handled = handled;
    });
    await advance(5 * 60_000);
    return outcome.handled;
  }

  it('goes out on the next run after an upload with no answer, once', async () => {
    await enqueue(feed('a'));
    unanswered = firstOf(UPLOAD);

    expect(await run()).toBe(0);
    expect(await pendingFeeds()).toHaveLength(1);

    expect(await run()).toBe(1);
    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
  });

  it('goes out once when the server saved it and only the answer was lost', async () => {
    await enqueue(feed('a'));
    unanswered = firstOf(SUBMIT);

    expect(await run()).toBe(0);
    expect(feeds.size).toBe(1);
    expect(await pendingFeeds()).toHaveLength(1);

    expect(await run()).toBe(1);
    expect(requested(SUBMIT)).toBe(2);
    expect(feeds.size).toBe(1);
    expect(await pendingFeeds()).toEqual([]);
  });
});

describe('a save whose answer never came', () => {
  let hooks: { rest: ReturnType<typeof useDayPass>; nudge: ReturnType<typeof useNudge>; buy: ReturnType<typeof useBuy> };

  function Saves() {
    hooks = { rest: useDayPass('pack'), nudge: useNudge('pack'), buy: useBuy('pack') };
    return null;
  }

  // The server refuses a second try at each of these, so the member can't spend anything twice.
  it.each([
    ['a rest day', 'use_day_pass', (onError: () => void) => hooks.rest.mutate('rest', { onError })],
    ['a nudge', 'nudge', (onError: () => void) => hooks.nudge.mutate('dan', { onError })],
    ['a purchase', 'buy_item', (onError: () => void) => hooks.buy.mutate('cap', { onError })],
  ])('tells the member about %s and sends nothing again by itself', async (_name, rpc, save) => {
    await open(Saves);
    unanswered = (url) => url.pathname === `/rest/v1/rpc/${rpc}`;
    const failed = jest.fn();
    await act(async () => save(failed));
    await advance(29_000);
    expect(failed).not.toHaveBeenCalled();

    await advance(10 * 60_000);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(requested(`/rest/v1/rpc/${rpc}`)).toBe(1);
  });
});

describe('deleting the account with no answer', () => {
  const FUNCTION = '/functions/v1/delete-account';

  async function tryToDelete() {
    const outcome: { done?: boolean } = {};
    void deleteAccount({ revokeApple: false }).then(
      () => {
        outcome.done = true;
      },
      () => {
        outcome.done = false;
      },
    );
    await advance(5 * 60_000);
    return outcome.done;
  }

  it('finishes on the phone when the account went on the server', async () => {
    unanswered = firstOf(FUNCTION);

    expect(await tryToDelete()).toBe(true);
    expect(requested(FUNCTION)).toBe(1);
    expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('says it failed and keeps the session when nothing can tell, and the next try finishes it', async () => {
    unanswered = () => true;

    expect(await tryToDelete()).toBe(false);
    expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull();

    unanswered = () => false;
    expect(await tryToDelete()).toBe(true);
    expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});
