import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactTestRenderer } from 'react-test-renderer';

// Starts of the app: the real root layout, auth provider, supabase-js and kept copy, against a
// stand-in for the network. Only what is native is replaced.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

const mockHideSplash = jest.fn();
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => true, hide: () => mockHideSplash() }));
jest.mock('@expo-google-fonts/rubik', () => ({ Rubik_400Regular: 1, Rubik_500Medium: 2, Rubik_700Bold: 3 }));
jest.mock('@expo-google-fonts/varela-round', () => ({ VarelaRound_400Regular: 4, useFonts: () => [true, null] }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({
  router: {},
  Stack: Object.assign(() => 'the app', { Protected: () => null, Screen: () => null }),
}));
jest.mock('@/components/ErrorScreen', () => ({ ErrorScreen: () => null }));
jest.mock('@/components/UpdateRequired', () => ({ UpdateRequired: () => null }));
jest.mock('@/features/auth/signIn', () => ({ forgetOtherAccounts: async () => undefined, signOut: async () => undefined }));
jest.mock('@/features/packs/invites', () => ({ readInstallReferrer: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));
jest.mock('@/lib/push', () => ({ registerPushToken: async () => undefined, unregisterPushToken: async () => undefined }));
jest.mock('@/lib/reportError', () => ({ sendPendingCrash: async () => undefined, watchForCrashes: () => undefined }));

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');
// What expo/fetch rejects with on a phone when a request is aborted.
const { FetchError } = jest.requireActual<typeof import('expo/src/winter/fetch/FetchErrors')>('expo/src/winter/fetch/FetchErrors');

// Each start loads every module again, as a start of the app does.
jest.setTimeout(60_000);

const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const PROFILE = {
  id: 'noa',
  display_name: 'Noa',
  avatar_path: null,
  terms_accepted_at: '2026-10-01T00:00:00Z',
  timezone: 'UTC',
  locale: 'en',
  reminder_time: '20:00',
  notification_prefs: {},
};

const nowSeconds = () => Math.floor(Date.now() / 1000);
let sessions = 0;

/** A session; auth-js remembers a failed refresh by its token, so each is new. */
function sessionOf(expires_at: number) {
  sessions += 1;
  return { access_token: 'noa-access', refresh_token: `noa-refresh-${sessions}`, token_type: 'bearer', expires_in: 3600, expires_at, user: USER };
}

function reply(status: number, body?: unknown) {
  const headers = { 'content-type': 'application/json', date: new Date().toUTCString() };
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function server(url: URL) {
  if (url.pathname === '/auth/v1/token') return reply(200, sessionOf(nowSeconds() + 3600));
  if (url.pathname === '/rest/v1/profiles') return reply(200, PROFILE);
  if (url.pathname === '/rest/v1/app_config') return reply(200, [{ min_version: '0.0.0' }]);
  return reply(204);
}

type Network = (url: URL, signal: AbortSignal | null | undefined) => Promise<Response>;

const refused: Network = async () => {
  throw new TypeError('Network request failed');
};
/** Takes every request and never answers, so each ends only when it is aborted. */
const silent: Network = (_url, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new FetchError('Fetch request has been canceled')));
  });
const answersAfter =
  (ms: number): Network =>
  (url) =>
    new Promise((resolve) => setTimeout(() => resolve(server(url)), ms));

let network: Network;

let renderer: typeof import('react-test-renderer');
let app: ReactTestRenderer;
/** Everything that was on screen since the app started. */
let shown: Set<string>;

function onScreen() {
  if (mockHideSplash.mock.calls.length === 0) return 'splash';
  const drawn = JSON.stringify(app.toJSON());
  if (drawn.includes("This didn't load")) return 'failed';
  if (drawn.includes('the app')) return 'the app';
  return drawn.includes('ActivityIndicator') ? 'spinner' : 'nothing';
}

/** A tenth of a second at a time, so what one moment sets off is in place for the next. */
async function advance(ms: number) {
  for (let passed = 0; passed < ms; passed += 100) {
    await renderer.act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    shown.add(onScreen());
  }
}

async function start({ session }: { session: 'good' | 'expired' | 'none' }) {
  if (session !== 'none') {
    const expires = nowSeconds() + (session === 'good' ? 3000 : -3600);
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(expires)));
  }
  jest.resetModules();
  renderer = jest.requireActual<typeof import('react-test-renderer')>('react-test-renderer');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { default: RootLayout } = jest.requireActual<typeof import('@/app/_layout')>('@/app/_layout');
  // Only now: loading the app sets up its own fetch.
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => network(new URL(String(input)), init?.signal)) as typeof fetch;
  await renderer.act(async () => {
    app = renderer.create(createElement(RootLayout));
  });
  shown.add(onScreen());
}

const tryAgain = () => renderer.act(async () => app.root.findByProps({ label: 'Try again' }).props.onPress());

const signIn = () => {
  const { supabase } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return renderer.act(async () => void supabase?.auth.signInWithPassword({ email: 'noa@gozali.test', password: 'password' }));
};

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
});

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  await AsyncStorage.clear();
  mockHideSplash.mockClear();
  shown = new Set();
  network = answersAfter(50);
});

afterEach(async () => {
  await renderer.act(async () => app.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('a start with no copy of the profile', () => {
  it('goes from the splash straight to the app on a good connection', async () => {
    await start({ session: 'good' });
    await advance(1000);

    expect(onScreen()).toBe('the app');
    expect([...shown]).toEqual(['splash', 'the app']);
  });

  it('says so after 8 s when a read never answers', async () => {
    network = silent;
    await start({ session: 'good' });

    await advance(7900);
    expect(onScreen()).toBe('splash');
    await advance(200);
    expect(onScreen()).toBe('failed');
  });

  it('says so after 8 s when an expired token is refreshed through a dead connection', async () => {
    network = refused;
    await start({ session: 'expired' });

    await advance(7900);
    expect(onScreen()).toBe('splash');
    await advance(200);
    expect(onScreen()).toBe('failed');
  });

  it('opens the app with no failure on the way when the answer takes 6 s', async () => {
    network = answersAfter(6000);
    await start({ session: 'good' });
    await advance(7000);

    expect(onScreen()).toBe('the app');
    expect(shown).not.toContain('failed');
  });

  it('opens the app by itself when the answer comes after the limit', async () => {
    network = answersAfter(9000);
    await start({ session: 'good' });

    await advance(8500);
    expect(onScreen()).toBe('failed');
    await advance(1500);
    expect(onScreen()).toBe('the app');
  });
});

describe('Try again', () => {
  it('shows the spinner, and fails again when the connection is still dead', async () => {
    network = refused;
    await start({ session: 'good' });
    await advance(10_000);
    expect(onScreen()).toBe('failed');

    await tryAgain();
    await advance(500);
    expect(onScreen()).toBe('spinner');

    await advance(8500);
    expect(onScreen()).toBe('failed');
  });

  it('gets the whole limit again while the first try is still running', async () => {
    network = silent;
    await start({ session: 'good' });
    await advance(9000);
    expect(onScreen()).toBe('failed');

    await tryAgain();
    await advance(7900);
    expect(onScreen()).toBe('spinner');
    await advance(200);
    expect(onScreen()).toBe('failed');
  });

  it('asks again at once on a connection that came back, not after the try still running', async () => {
    network = silent;
    await start({ session: 'good' });
    await advance(9000);
    expect(onScreen()).toBe('failed');

    network = answersAfter(50);
    await tryAgain();
    await advance(1000);
    expect(onScreen()).toBe('the app');
  });
});

describe('a sign-in', () => {
  it('gets a wait of its own, with no failure when the profile takes 5 s', async () => {
    network = answersAfter(5000);
    await start({ session: 'none' });
    await advance(10_000);
    expect(onScreen()).toBe('the app');

    await signIn();
    await advance(11_000);

    expect(onScreen()).toBe('the app');
    expect(shown).toContain('spinner');
    expect(shown).not.toContain('failed');
  });
});

describe('a start with the profile kept on the phone', () => {
  it('opens the app at once, with nothing answering', async () => {
    await start({ session: 'good' });
    // Past the second a save can be held back.
    await advance(3000);
    await renderer.act(async () => app.unmount());
    mockHideSplash.mockClear();
    shown = new Set();

    network = silent;
    await start({ session: 'good' });
    await advance(9000);

    expect([...shown]).toEqual(['the app']);
  });
});
