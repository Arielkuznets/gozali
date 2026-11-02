import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentType } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import type { OutgoingFeed } from '@/features/feeds/send';

// The real supabase-js and the app's own client, hooks and queue, against a stand-in for a server
// that takes a request and never answers it. Such a request ends only when it is aborted, as on a
// connection that died quietly. Only what is native is replaced.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

/** How long reading a photo takes, if it isn't at once. */
let mockReadTakes = 0;
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
      if (mockReadTakes > 0) await new Promise((resolve) => setTimeout(resolve, mockReadTakes));
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
const { useCountedFeeds, useFeedQueue, usePackFeed, usePendingFeeds, useSendFeed } = jest.requireActual<typeof import('@/features/feeds/api')>('@/features/feeds/api');
const { enqueue, flushQueue, pendingFeeds } = jest.requireActual<typeof import('@/features/feeds/queue')>('@/features/feeds/queue');
const { useDayPass } = jest.requireActual<typeof import('@/features/days/api')>('@/features/days/api');
const { useBuy, useNudge } = jest.requireActual<typeof import('@/features/social/api')>('@/features/social/api');
const { deleteAccount } = jest.requireActual<typeof import('@/features/auth/signIn')>('@/features/auth/signIn');
// What expo/fetch rejects with on a phone when a request is aborted.
const { FetchError } = jest.requireActual<typeof import('expo/src/winter/fetch/FetchErrors')>('expo/src/winter/fetch/FetchErrors');

const UPLOAD = '/storage/v1/object/feed-photos/';
const SUBMIT = '/rest/v1/rpc/submit_feed';
/** A caption the word filter turns down. */
const BLOCKED = 'Kicked ass today';
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
let fedOnAnotherPhone = false;
/** The server does the work of these, but no answer comes back. */
let unanswered: (url: URL, init?: RequestInit) => boolean = () => false;
/** The server's answer to these starts, and stops after the headers. */
let answeredHalfway: (url: URL) => boolean = () => false;
/** How long the server takes over a request, if it isn't at once. */
let slowBy: (url: URL) => number = () => 0;
/** The server does the work of these at once, and the answer takes this long to get back. */
let lateBy: (url: URL) => number = () => 0;
/** The next save meets another save of the same feed, and loses. */
let losesTheRace = false;
/** These fail at once, as on a phone with no connection. */
let noConnection: (url: URL) => boolean = () => false;
/** What asking whether a photo is there meets, when it isn't an answer at once. */
let askingMeets: ((init?: RequestInit) => Promise<Response>) | null = null;

/** Only the first of these goes unanswered: the connection comes back behind it. */
function firstOf(path: string) {
  let gone = false;
  return (url: URL) => {
    if (gone || !url.pathname.startsWith(path)) return false;
    gone = true;
    return true;
  };
}

/** Only the first of these takes that long. */
function firstBy(path: string, ms: number) {
  const first = firstOf(path);
  return (url: URL) => (first(url) ? ms : 0);
}

function reply(status: number, body?: unknown) {
  const headers = { 'content-type': 'application/json', date: new Date().toUTCString() };
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

const refusal = (message: string, code = 'P0001') => reply(400, { code, details: null, hint: null, message });

function server(url: URL, init: RequestInit | undefined, caller: string | null) {
  const path = url.pathname;
  if (path === '/auth/v1/token') {
    if (accountGone) return reply(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    return reply(200, sessionOf(nowSeconds() + 3600));
  }
  if (path === '/auth/v1/user') {
    return accountGone ? reply(404, { error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }) : reply(200, sessionOf(0).user);
  }
  if (path === '/auth/v1/logout') return reply(204);
  // Storage says the same to a file that isn't there and to a caller who may not see it.
  if (init?.method === 'HEAD') return reply(photos.has(path) && caller !== null ? 200 : 400);
  // What the API and storage say to a request that went out without the user's token.
  if ((caller === null || accountGone) && path.startsWith(UPLOAD)) {
    return reply(400, { statusCode: '403', code: 'AccessDenied', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  }
  if (caller === null) return reply(401, { code: '42501', details: null, hint: null, message: 'permission denied for function submit_feed' });
  if (path === '/functions/v1/delete-account') {
    // The function turns down the token of an account that is gone.
    if (accountGone) return new Response('not signed in', { status: 401 });
    accountGone = true;
    return reply(200, { deleted: true, photos: 0 });
  }
  if (path === '/rest/v1/packs') return reply(200, { id: 'pack', name: 'Gym squad', timezone: 'UTC', pack_members: [], critters: null });
  if (path === '/rest/v1/feeds') return reply(200, []);
  if (`${path}/` === UPLOAD && init?.method === 'DELETE') {
    const { prefixes } = JSON.parse(String(init.body)) as { prefixes: string[] };
    for (const name of prefixes) photos.delete(`${UPLOAD}${name}`);
    return reply(200, []);
  }
  if (path.startsWith(UPLOAD)) {
    if (photos.has(path)) return reply(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    photos.add(path);
    return reply(200, { Id: 'object', Key: path });
  }
  if (path === SUBMIT) {
    const { photo, extra, note } = JSON.parse(String(init?.body)) as { photo: string; extra: boolean; note?: string };
    if (losesTheRace) {
      losesTheRace = false;
      return refusal('already_fed');
    }
    if (feeds.has(photo)) return reply(200, feeds.get(photo));
    if (!photos.has(`${UPLOAD}${photo}`)) return refusal('photo_missing');
    if (note === BLOCKED) return refusal('text_not_allowed', '22023');
    if (fedOnAnotherPhone && !extra) return refusal('already_fed');
    feeds.set(photo, `feed-${feeds.size + 1}`);
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
    if (noConnection(url)) return Promise.reject(new TypeError('Network request failed'));
    // No photo goes with this, so what holds a slow upload back doesn't hold it back.
    if (init?.method === 'HEAD') return askingMeets?.(init) ?? Promise.resolve(server(url, init, caller));
    const slow = slowBy(url);
    if (slow > 0) return new Promise((resolve) => setTimeout(() => resolve(server(url, init, caller)), slow));
    const answer = server(url, init, caller);
    const late = lateBy(url);
    if (late > 0) return new Promise((resolve) => setTimeout(() => resolve(answer), late));
    if (answeredHalfway(url)) return Promise.resolve(new Response(new ReadableStream(), { headers: answer.headers }));
    if (!unanswered(url, init)) return Promise.resolve(answer);
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
  fedOnAnotherPhone = false;
  unanswered = () => false;
  answeredHalfway = () => false;
  slowBy = () => 0;
  lateBy = () => 0;
  losesTheRace = false;
  noConnection = () => false;
  askingMeets = null;
  mockReadTakes = 0;
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

  it('stays in the queue when its token runs out during the send, and goes out on the next run', async () => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() + 50)));
    await enqueue(feed('a'));
    noConnection = (url) => url.pathname === '/auth/v1/token';
    void requireSupabase().auth.getSession();
    await advance(31_000);

    lateBy = firstBy(UPLOAD, 25_000);
    expect(await run()).toBe(0);
    expect(await pendingFeeds()).toHaveLength(1);
    expect(requested(`POST ${SUBMIT} by null`)).toBe(1);

    noConnection = () => false;
    expect(await run()).toBe(1);
    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
  });

  describe('refused for going out with no token, with the session back when the answer lands', () => {
    /** The token ends a minute from now, and auth-js holds the next refresh until about 85 s from now. */
    async function refreshFails() {
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() + 60)));
      await enqueue(feed('a'));
      noConnection = (url) => url.pathname === '/auth/v1/token';
      void requireSupabase().auth.getSession();
    }

    it('keeps the feed and its photo when the save was refused', async () => {
      await refreshFails();
      await advance(58_000);
      lateBy = (url) => (url.pathname.startsWith(UPLOAD) ? 27_000 : url.pathname === SUBMIT ? 2_000 : 0);

      void flushQueue();
      await advance(27_100);
      expect(requested(`POST ${SUBMIT} by null`)).toBe(1);
      noConnection = () => false;
      await advance(10_000);

      expect(await pendingFeeds()).toHaveLength(1);
      expect(photos.size).toBe(1);
      expect(requested('DELETE')).toBe(0);

      lateBy = () => 0;
      expect(await run()).toBe(1);
      expect(await pendingFeeds()).toEqual([]);
      expect(feeds.size).toBe(1);
    });

    it('keeps the feed when the photo was refused', async () => {
      await refreshFails();
      await advance(59_900);
      mockReadTakes = 200;
      lateBy = (url) => (url.pathname.startsWith(UPLOAD) ? 27_000 : 0);

      void flushQueue();
      await advance(1_000);
      expect(requested(`POST ${UPLOAD}pack/noa/a.jpg by null`)).toBe(1);
      noConnection = () => false;
      await advance(30_000);

      expect(await pendingFeeds()).toHaveLength(1);

      lateBy = () => 0;
      expect(await run()).toBe(1);
      expect(await pendingFeeds()).toEqual([]);
      expect(feeds.size).toBe(1);
    });
  });

  describe('of an account deleted on another phone', () => {
    it('is dropped while its token still works, and the member hears why', async () => {
      AppState.currentState = 'active';
      await enqueue(feed('a'));
      accountGone = true;

      expect(await flushQueue()).toEqual({ handled: 1, dropped: ['AccessDenied new row violates row-level security policy'], unreported: ['AccessDenied new row violates row-level security policy'], stuck: [] });
      expect(await pendingFeeds()).toEqual([]);
    });

    it('sends nothing more once its token ran out, and waits on the phone for the next account to clear it', async () => {
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() - 60)));
      await enqueue(feed('a'));
      accountGone = true;

      expect(await run()).toBe(0);
      expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
      expect(await pendingFeeds()).toHaveLength(1);

      expect(await run()).toBe(0);
      expect(requests).toEqual(['POST /auth/v1/token by null']);
    });
  });

  it('sends no photo that already landed: it asks storage first', async () => {
    await enqueue(feed('a'));
    photos.add(`${UPLOAD}pack/noa/a.jpg`);

    expect(await run()).toBe(1);

    expect(requests).toEqual([`HEAD ${UPLOAD}pack/noa/a.jpg by noa`, `POST ${SUBMIT} by noa`]);
    expect(feeds.size).toBe(1);
    expect(await pendingFeeds()).toEqual([]);
  });

  it.each([
    ['an error', () => Promise.resolve(reply(500))],
    ['no connection', () => Promise.reject(new TypeError('Network request failed'))],
    [
      'no answer',
      (init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new FetchError('Fetch request has been canceled')));
        }),
    ],
  ])('uploads the photo when asking storage meets %s', async (_name, meets) => {
    await enqueue(feed('a'));
    askingMeets = meets;

    expect(await run()).toBe(1);

    expect(requested(`POST ${UPLOAD}`)).toBe(1);
    expect(feeds.size).toBe(1);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('uploads its photo again when the server no longer has it', async () => {
    await enqueue(feed('a'));
    slowBy = firstBy(SUBMIT, 1_000);
    const outcome: { result?: unknown } = {};
    void flushQueue().then((result) => {
      outcome.result = result;
    });
    await advance(500);
    photos.clear();
    await advance(1_000);

    expect(outcome.result).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [expect.objectContaining({ message: 'photo_missing' })] });
    expect(await pendingFeeds()).toHaveLength(1);

    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
    expect(await pendingFeeds()).toEqual([]);
    expect(photos.size).toBe(1);
    expect(feeds.size).toBe(1);
  });
});

describe('a send given up on, beside the queue try at the same feed', () => {
  let send: ReturnType<typeof useSendFeed>['mutateAsync'];

  function Camera() {
    send = useSendFeed().mutateAsync;
    return null;
  }

  /** Send is tapped and the photo lands, but its answer comes after the feed was saved for later. */
  async function tapAndGiveUp(outgoing: OutgoingFeed) {
    await open(Camera);
    lateBy = firstBy(UPLOAD, 45_000);
    const told: { outcome?: string } = {};
    void send(outgoing).then((outcome) => {
      told.outcome = outcome;
    });
    await advance(31_000);
    expect(told.outcome).toBe('queued');
  }

  /** The queue's try gets past the upload, and is still saving when the first send hears its answer. */
  async function runBesideIt() {
    slowBy = firstBy(SUBMIT, 20_000);
    const outcome: { result?: unknown } = {};
    void flushQueue().then((result) => {
      outcome.result = result;
    });
    await advance(5 * 60_000);
    return outcome.result;
  }

  it('leaves the photo to the queue on a day fed from another phone, and it goes up as an extra', async () => {
    fedOnAnotherPhone = true;
    await tapAndGiveUp(feed('a'));

    expect(await runBesideIt()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });

    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
    expect(photos.size).toBe(1);
  });

  it('leaves the photo to the queue when the filter turns down the caption, and it goes up without it', async () => {
    await tapAndGiveUp({ ...feed('a'), caption: BLOCKED });

    expect(await runBesideIt()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });

    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
    expect(photos.size).toBe(1);
  });

  it('keeps the photo of the feed that won when both reach the server together', async () => {
    await tapAndGiveUp(feed('a'));
    await flushQueue();
    expect(feeds.size).toBe(1);

    losesTheRace = true;
    await advance(60_000);

    expect(requested('DELETE')).toBe(0);
    expect(photos.size).toBe(1);
    expect(await pendingFeeds()).toEqual([]);
  });
});

describe('a queue run on a dead connection', () => {
  async function runFor(seconds: number) {
    const outcome: { result?: unknown } = {};
    void flushQueue().then((result) => {
      outcome.result = result;
    });
    await advance(seconds * 1000);
    return outcome.result;
  }

  it.each([
    ['an upload with no answer', () => (unanswered = firstOf(UPLOAD))],
    ['an answer that stops halfway', () => (answeredHalfway = firstOf(UPLOAD))],
  ])('ends within the limit of a try on %s, says nothing, and the next run sends the feed', async (_name, die) => {
    await enqueue(feed('a'));
    die();

    expect(await runFor(170)).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
    expect(await pendingFeeds()).toHaveLength(1);

    expect(await runFor(1)).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
  });
});

describe('a feed waiting with the app left open', () => {
  const appStates = new Set<(state: AppStateStatus) => void>();
  let send: ReturnType<typeof useSendFeed>['mutateAsync'];

  function Pack() {
    useFeedQueue();
    send = useSendFeed().mutateAsync;
    usePendingFeeds('pack');
    return null;
  }

  const card = () => client.getQueryData<OutgoingFeed[]>(['feeds', 'pending', 'pack']);

  /** Send is tapped, and what the member was told comes back. */
  async function tapSend(seconds: number) {
    const told: { outcome?: string } = {};
    void send(feed('a')).then((outcome) => {
      told.outcome = outcome;
    });
    await advance(seconds * 1000);
    return told.outcome;
  }

  beforeEach(() => {
    AppState.currentState = 'active';
    appStates.clear();
    jest.mocked(AppState.addEventListener).mockImplementation((_type, listener) => {
      appStates.add(listener);
      return { remove: () => appStates.delete(listener) };
    });
  });

  it('goes out within a minute of a try that failed with the connection up', async () => {
    await open(Pack);
    noConnection = (url) => url.pathname.startsWith(UPLOAD);
    expect(await tapSend(1)).toBe('queued');
    noConnection = () => false;
    expect(await pendingFeeds()).toHaveLength(1);

    await advance(60_000);

    expect(await pendingFeeds()).toEqual([]);
    expect(card()).toEqual([]);
    expect(feeds.size).toBe(1);
  });

  it('goes out after a run that stopped, though the return to the app during it did nothing', async () => {
    await enqueue(feed('a'));
    unanswered = firstOf(UPLOAD);
    await open(Pack);
    await advance(10_000);
    await act(async () => appStates.forEach((listener) => listener('active')));
    await advance(140_000);
    expect(requested(`POST ${UPLOAD}`)).toBe(1);
    expect(await pendingFeeds()).toHaveLength(1);

    await advance(40_000);

    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
  });

  it('takes the card off when a slow send landed by itself', async () => {
    await open(Pack);
    await advance(1_000);
    lateBy = firstBy(UPLOAD, 45_000);
    expect(await tapSend(31)).toBe('queued');
    await advance(16_000);
    expect(feeds.size).toBe(1);
    expect(await pendingFeeds()).toHaveLength(1);
    expect(card()).toHaveLength(1);

    await advance(13_000);

    expect(await pendingFeeds()).toEqual([]);
    expect(card()).toEqual([]);
    expect(requested(SUBMIT)).toBe(2);
    expect(feeds.size).toBe(1);
  });

  it.each([37, 150])('sends every feed on a link where each photo takes %i s, once each', async (seconds) => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    slowBy = (url) => (url.pathname.startsWith(UPLOAD) ? seconds * 1000 : 0);
    await open(Pack);

    await advance(2 * seconds * 1000 + 60_000);

    expect(feeds.size).toBe(2);
    expect(requested(`POST ${UPLOAD}`)).toBe(2);
    expect(await pendingFeeds()).toEqual([]);
    expect(card()).toEqual([]);
  });

  it('adds nothing to a run that is still going', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    await enqueue(feed('c'));
    slowBy = (url) => (url.pathname === SUBMIT ? 25_000 : 0);
    await open(Pack);

    await advance(80_000);

    expect(requested(SUBMIT)).toBe(3);
    expect(feeds.size).toBe(3);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('leaves it alone while the app is in the background', async () => {
    await enqueue(feed('a'));
    noConnection = (url) => url.pathname.startsWith(UPLOAD);
    await open(Pack);
    await advance(1_000);
    const tries = requested(UPLOAD);
    AppState.currentState = 'background';

    await advance(10 * 60_000);

    expect(requested(UPLOAD)).toBe(tries);
  });

  it('stops with the screen that keeps it going', async () => {
    await enqueue(feed('a'));
    noConnection = (url) => url.pathname.startsWith(UPLOAD);
    await open(Pack);
    await advance(1_000);
    const tries = requested(UPLOAD);
    await act(async () => app?.unmount());
    app = undefined;

    await advance(10 * 60_000);

    expect(requested(UPLOAD)).toBe(tries);
  });
});

describe('Send on a dead connection', () => {
  let send: ReturnType<typeof useSendFeed>['mutateAsync'];

  /** The camera, with the pack screen and its reads mounted under it. */
  function Camera() {
    send = useSendFeed().mutateAsync;
    useCountedFeeds();
    usePackFeed('pack', 30);
    usePendingFeeds('pack');
    return null;
  }

  /** What the member was told after tapping Send, and how many seconds later. */
  async function tapSend() {
    const started = Date.now();
    const told: { outcome?: string; seconds?: number } = {};
    void send(feed('a')).then((outcome) => {
      told.outcome = outcome;
      told.seconds = (Date.now() - started) / 1000;
    });
    await advance(5 * 60_000);
    return told;
  }

  it.each([
    ['nothing answers', () => (unanswered = () => true)],
    ['the photo gets no answer', () => (unanswered = (url) => url.pathname.startsWith(UPLOAD))],
    ['saving the feed gets no answer', () => (unanswered = (url) => url.pathname === SUBMIT)],
    ['the answer stops halfway', () => (answeredHalfway = (url) => url.pathname === SUBMIT)],
  ])('keeps the feed for later within half a minute when %s', async (_name, die) => {
    await open(Camera);
    await advance(1_000);
    die();

    const told = await tapSend();

    expect(told.outcome).toBe('queued');
    expect(told.seconds).toBeLessThanOrEqual(30);
    expect(await pendingFeeds()).toHaveLength(1);
  });

  it('keeps the feed for later within half a minute behind a token refresh with no answer', async () => {
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() - 60)));
    unanswered = (url) => url.pathname === '/auth/v1/token';
    await open(Camera);
    await advance(1_000);

    const told = await tapSend();

    expect(told.outcome).toBe('queued');
    expect(told.seconds).toBeLessThanOrEqual(30);
    expect(await pendingFeeds()).toHaveLength(1);
  });

  it('keeps it as an extra when the try after a feed from another phone gets no answer', async () => {
    await open(Camera);
    await advance(1_000);
    fedOnAnotherPhone = true;
    unanswered = (url, init) => url.pathname === SUBMIT && String(init?.body).includes('"extra":true');

    const told = await tapSend();

    expect(told).toEqual({ outcome: 'queued', seconds: 30 });
    expect(await pendingFeeds()).toEqual([expect.objectContaining({ id: 'a', extra: true })]);
  });

  it('lets a send that was only slow land, and the queue finds it there', async () => {
    await open(Camera);
    await advance(1_000);
    slowBy = (url) => (url.pathname.startsWith(UPLOAD) ? 45_000 : 0);

    const told = await tapSend();

    expect(told).toEqual({ outcome: 'queued', seconds: 30 });
    expect(feeds.size).toBe(1);
    expect(await pendingFeeds()).toHaveLength(1);

    slowBy = () => 0;
    await flushQueue();
    expect(await pendingFeeds()).toEqual([]);
    expect(requested(SUBMIT)).toBe(2);
    expect(requested(`POST ${UPLOAD}`)).toBe(1);
    expect(feeds.size).toBe(1);
  });

  it('goes through as before on a good connection', async () => {
    await open(Camera);
    await advance(1_000);

    expect(await tapSend()).toEqual({ outcome: 'sent', seconds: 0 });
    expect(await pendingFeeds()).toEqual([]);
    expect(feeds.size).toBe(1);
    expect(requested('HEAD')).toBe(0);
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
