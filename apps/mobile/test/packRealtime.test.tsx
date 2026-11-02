import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { usePackRealtime } from '@/features/packs/realtime';

// The app's own client, so the real auth-js and realtime-js, made anew for each cold start, against
// stand-ins for the server and its socket. What a join carries is read from what the socket is sent.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

/** Where the client finds its session, going by the address above. */
const AUTH_KEY = 'sb-gozali-auth-token';
const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };

type Client = ReturnType<(typeof import('@/lib/supabase'))['requireSupabase']>;
let mockClient: Client;
jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockClient;
  },
}));

type Frame = { event: string; payload: Record<string, unknown> };
let frames: Frame[] = [];
const tokens = (event: string) => frames.filter((frame) => frame.event === event).map((frame) => frame.payload.access_token);
/** The token the server goes by: the last one it was sent, on a join or after it. */
const tokenHeld = () => frames.filter((frame) => frame.event === 'phx_join' || frame.event === 'access_token').at(-1)?.payload.access_token;

/** An answer the test lets out when it wants to. */
function held() {
  let release = () => {};
  const answer = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

/** The socket's answers wait for this, as on a connection slower than the refresh. */
let socketAnswers = Promise.resolve();

/** Every socket the client opened, the last one the live one. */
let sockets: StandInSocket[] = [];

/** Opens on the next turn, and says yes to everything as the server does to a good join. */
class StandInSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;

  constructor() {
    sockets.push(this);
    setImmediate(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string) {
    const [joinRef, ref, topic, event, payload] = JSON.parse(data) as [string, string, string, string, Frame['payload']];
    frames.push({ event, payload });
    const asked = (payload.config as { postgres_changes: object[] } | undefined)?.postgres_changes;
    const response = { postgres_changes: asked?.map((change, id) => ({ ...change, id })) };
    void socketAnswers.then(() => {
      setImmediate(() => {
        this.onmessage?.({ data: JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]) });
      });
    });
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  /** Gone with the app open: a lost route, or a restart of Realtime. */
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const sessionOf = (name: string, expires_at: number) => ({
  access_token: name,
  refresh_token: `${name}-refresh`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at,
  user: USER,
});

const storeSession = (expires_at: number) => AsyncStorage.setItem(AUTH_KEY, JSON.stringify(sessionOf('stored', expires_at)));

/** What the server does with a refresh before it answers; by default it waits for the test. */
let beforeAnswering: (init?: RequestInit) => Promise<unknown>;
let refresh = held();

const noConnection = async () => {
  throw new TypeError('Network request failed');
};
const noAnswer = (init?: RequestInit) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new TypeError('Request aborted')));
  });

async function server(_input: RequestInfo | URL, init?: RequestInit) {
  await beforeAnswering(init);
  const body = JSON.stringify(sessionOf('refreshed', nowSeconds() + 3600));
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A cold start: the new client reads the stored session and refreshes it if it must. */
function startApp() {
  jest.isolateModules(() => {
    mockClient = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase').requireSupabase();
  });
}

function Screen({ packId }: { packId?: string }) {
  usePackRealtime(packId);
  return null;
}

async function open(...screens: (string | undefined)[]) {
  let app!: ReactTestRenderer;
  await act(async () => {
    app = create(
      <QueryClientProvider client={new QueryClient()}>
        {screens.map((packId, index) => (
          <Screen key={index} packId={packId} />
        ))}
      </QueryClientProvider>,
    );
  });
  return app;
}

/** Enough turns for whatever is on its way to arrive; nothing here depends on a real clock. */
async function settle() {
  for (let turn = 0; turn < 20; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Moves the test's clock a second at a time, so that the socket's answers get their turns. */
async function pass(seconds: number) {
  for (let second = 0; second < seconds; second += 1) await jest.advanceTimersByTimeAsync(1000);
}

const realSocket = globalThis.WebSocket;

beforeAll(() => {
  // auth-js says so on the console each time a refresh can't reach the server.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  globalThis.WebSocket = StandInSocket as unknown as typeof WebSocket;
  globalThis.fetch = jest.fn(server) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.WebSocket = realSocket;
});

beforeEach(async () => {
  await AsyncStorage.clear();
  frames = [];
  sockets = [];
  socketAnswers = Promise.resolve();
  refresh = held();
  beforeAnswering = () => refresh.answer;
});

afterEach(async () => {
  // Closing the socket starts a timer that realtime-js never stops; this way it dies with the test.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  await mockClient.auth.stopAutoRefresh();
  await mockClient.removeAllChannels();
  await mockClient.realtime.disconnect();
  jest.useRealTimers();
});

describe('joining Realtime on a token that has run out', () => {
  it('goes out with the new token, on a connection slower than the refresh', async () => {
    const slow = held();
    socketAnswers = slow.answer;
    await storeSession(nowSeconds() - 3600);
    startApp();
    await open(undefined);
    await settle();
    refresh.release();
    await settle();
    slow.release();
    await settle();
    expect(tokenHeld()).toBe('refreshed');
    expect(tokens('phx_join')).toStrictEqual(['refreshed']);
  });

  it('does so for every screen that opens at once', async () => {
    await storeSession(nowSeconds() - 3600);
    startApp();
    await open(undefined, 'pack');
    await settle();
    refresh.release();
    await settle();
    expect(tokens('phx_join')).toStrictEqual(['refreshed', 'refreshed']);
  });

  it('never goes out for a screen that left before the token came', async () => {
    await storeSession(nowSeconds() - 3600);
    startApp();
    const app = await open(undefined);
    await settle();
    await act(async () => app.unmount());
    refresh.release();
    await settle();
    expect(tokens('phx_join')).toHaveLength(0);
    expect(mockClient.getChannels()).toHaveLength(0);
  });

  it.each([
    ['no connection', noConnection],
    ['no answer', noAnswer],
  ])('goes out once a refresh with %s gives up, and the token follows when one lands', async (_, failing) => {
    await storeSession(nowSeconds() - 3600);
    beforeAnswering = failing;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    startApp();
    await open(undefined);
    await pass(40);
    expect(tokens('phx_join')).toHaveLength(1);

    beforeAnswering = async () => undefined;
    await pass(120);
    expect(tokenHeld()).toBe('refreshed');
    expect(tokens('phx_join')).toHaveLength(1);
  });
});

describe('joining Realtime on a good token', () => {
  it('goes out with that token, for every screen', async () => {
    await storeSession(nowSeconds() + 3600);
    startApp();
    await open(undefined, 'pack');
    await settle();
    expect(tokens('phx_join')).toStrictEqual(['stored', 'stored']);
  });

  it('goes out even if asking for the token fails', async () => {
    await storeSession(nowSeconds() + 3600);
    startApp();
    jest.spyOn(mockClient.realtime, 'setAuth').mockRejectedValueOnce(new Error('No token'));
    await open(undefined);
    await settle();
    expect(tokens('phx_join')).toHaveLength(1);
  });
});

describe('a socket that drops with the app open', () => {
  let invalidated: jest.SpyInstance;
  /** Each read covers the feeds, so these count the reads. */
  const reads = () => invalidated.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === 'feeds').length;
  const joins = () => tokens('phx_join').length;

  /** The app with the home screen and a pack on top of it, as it always is. */
  async function openApp() {
    await storeSession(nowSeconds() + 3600);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    startApp();
    await open(undefined, 'pack');
    await pass(1);
    expect(joins()).toBe(2);
  }

  /** Lost for a moment: the client connects again a second later, and both channels rejoin. */
  async function dropAndRejoin() {
    sockets.at(-1)?.drop();
    await pass(2);
    await settle();
  }

  beforeEach(() => {
    invalidated = jest.spyOn(QueryClient.prototype, 'invalidateQueries');
  });

  afterEach(() => {
    invalidated.mockRestore();
  });

  it('reads nothing on the first join', async () => {
    await openApp();
    await pass(60);
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('reads what it may have missed once its channels are back, once for all of them', async () => {
    await openApp();
    await dropAndRejoin();

    expect(joins()).toBe(4);
    expect(invalidated.mock.calls.map(([filters]) => filters.queryKey[0]).sort()).toEqual(['days', 'feeds', 'packs', 'social']);
  });

  it('reads again for another drop later on', async () => {
    await openApp();
    await dropAndRejoin();
    await pass(30);
    await dropAndRejoin();
    expect(reads()).toBe(2);
  });

  it('keeps to one read each half a minute while the socket keeps dropping', async () => {
    await openApp();
    for (let drop = 0; drop < 30; drop += 1) await dropAndRejoin();

    expect(joins()).toBe(2 + 2 * 30);
    expect(reads()).toBeLessThanOrEqual(3);
  });

  it('reads after the last rejoin, whenever in the half minute that came', async () => {
    await openApp();
    await dropAndRejoin();
    await pass(5);
    await dropAndRejoin();
    expect(reads()).toBe(1);

    await pass(30);
    expect(reads()).toBe(2);
    await pass(60);
    expect(reads()).toBe(2);
  });

  it('stops waiting to read once the screen is gone', async () => {
    await storeSession(nowSeconds() + 3600);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    startApp();
    const app = await open(undefined);
    await pass(1);
    await dropAndRejoin();
    await pass(5);
    await dropAndRejoin();
    await act(async () => app.unmount());

    await pass(60);
    expect(reads()).toBe(1);
  });
});
