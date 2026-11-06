import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { useEffect } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import AppStack from '@/app/(app)/_layout';
import NotFound from '@/app/+not-found';
import AuthCallback from '@/app/auth/callback';
import DevLoginRoute from '@/app/dev-login';
import InviteLinkScreen from '@/app/i/[code]';
import { savePendingInvite, takePendingInvite } from '@/features/packs/invites';
import { isProfileComplete, useProfile, type Profile } from '@/features/profile/useProfile';

// The real router, the app's own stack and the real link routes, under guards like the root
// layout's. A link reaches the router the way it does on a phone: through the listener on
// expo-linking.
let mockLinkListener: ((event: { url: string }) => void) | null = null;
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path: string) => `gozali://${path}`,
  resolveScheme: () => 'gozali',
  addEventListener: (_event: string, listener: (event: { url: string }) => void) => {
    mockLinkListener = listener;
    return { remove: () => undefined };
  },
}));
type Tap = { notification: { request: { content: { data: { url: string } } } } };
const mockTapListeners = new Set<(response: Tap) => void>();
/** The phone keeps every tap, the one that started the app or a later one, until the app clears it. */
let mockLastTap: Tap | null = null;
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getLastNotificationResponseAsync: async () => mockLastTap,
  clearLastNotificationResponseAsync: async () => {
    mockLastTap = null;
  },
  addNotificationResponseReceivedListener: (listener: (response: Tap) => void) => {
    mockTapListeners.add(listener);
    return { remove: () => mockTapListeners.delete(listener) };
  },
}));
jest.mock('@/lib/push', () => ({}));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/features/feeds/api', () => ({ useFeedQueue: () => undefined }));
jest.mock('@/features/profile/useProfile', () => ({
  ...jest.requireActual('@/features/profile/useProfile'),
  useAccountSync: () => undefined,
}));
jest.mock('@/features/widgets/sync', () => ({ useWidgetSync: () => undefined }));
let mockSession: { user: { id: string } } | null = null;
const mockSessionWatchers = new Set<() => void>();
jest.mock('@/features/auth/AuthProvider', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const watch = (watcher: () => void) => {
    mockSessionWatchers.add(watcher);
    return () => mockSessionWatchers.delete(watcher);
  };
  return { useAuth: () => ({ session: useSyncExternalStore(watch, () => mockSession), loading: false }) };
});
let mockAnswerProfile: ((answer: { data: unknown; error: null }) => void) | null = null;
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            new Promise((resolve) => {
              mockAnswerProfile = resolve;
            }),
        }),
      }),
    }),
  }),
}));

const USER = 'user-1';
const CODE = 'ABCD2345';
const FULL = new Error('database or disk is full');
const started = { id: USER, display_name: null, terms_accepted_at: null } as Profile;
const finished = { ...started, display_name: 'Maya', terms_accepted_at: '2026-11-01T00:00:00Z' };

function RootLayout() {
  const { data } = useProfile();
  const signedIn = mockSession !== null;
  const profileComplete = isProfileComplete(data);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn && profileComplete}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !profileComplete}>
        <Stack.Screen name="profile-setup" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="dev-login" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="i/[code]" />
    </Stack>
  );
}

const opened: string[] = [];

function Opens({ name }: { name: string }) {
  useEffect(() => {
    opened.push(name);
  }, [name]);
  return <Text>{name}</Text>;
}

let appLayouts = 0;

function AppLayout() {
  useEffect(() => {
    appLayouts += 1;
    return () => {
      appLayouts -= 1;
    };
  }, []);
  return <AppStack />;
}

function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Opens name={`join ${code}`} />;
}

const routes = {
  _layout: { default: RootLayout },
  '(app)/_layout': { default: AppLayout, unstable_settings: { initialRouteName: 'index' } },
  '(app)/index': { default: () => <Opens name="home" /> },
  '(app)/join': { default: Join },
  '(app)/pack/[id]/index': { default: () => <Opens name="pack" /> },
  '(app)/pack/[id]/feed': { default: () => <Opens name="camera" /> },
  '(app)/pack/[id]/not-today': { default: () => <Opens name="not today" /> },
  'profile-setup': { default: () => <Opens name="setup" /> },
  welcome: { default: () => <Opens name="welcome" /> },
  'dev-login': { default: DevLoginRoute },
  'auth/callback': { default: AuthCallback },
  'i/[code]': { default: InviteLinkScreen },
  '+not-found': { default: NotFound },
};

let client: QueryClient;
let app: ReactTestRenderer;

async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
  }
}

async function start(location: string) {
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <ExpoRoot context={getMockContext(routes as never)} location={location} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function followLink(url: string) {
  await act(async () => mockLinkListener?.({ url }));
  await settle();
}

/** The screens of the root stack, which the router keeps under a route of its own. */
const rootStack = () => store.state?.routes[0]?.state?.routes ?? [];
const rootRoutes = () => rootStack().map((route) => route.name);
const appStack = () => rootStack()[0]?.state?.routes.map((route) => route.name) ?? [];

function signInWith(profile: Profile) {
  mockSession = { user: { id: USER } };
  client.setQueryData(['profile', USER], profile);
}

async function openPack() {
  signInWith(finished);
  await start('/');
  await act(async () => router.push('/pack/p1'));
  await settle();
}

async function goBack() {
  await act(async () => router.back());
  await settle();
}

/** A session that starts or ends while the app is open, as AuthProvider tells every screen. */
async function sessionBecomes(session: typeof mockSession) {
  await act(async () => {
    mockSession = session;
    mockSessionWatchers.forEach((watcher) => watcher());
  });
  await settle();
}

const tapOn = (url: string): Tap => ({ notification: { request: { content: { data: { url } } } } });

async function tapNotification(url: string) {
  await act(async () => {
    mockLastTap = tapOn(url);
    for (const listener of mockTapListeners) listener(mockLastTap);
  });
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  opened.length = 0;
  mockSession = null;
  mockAnswerProfile = null;
  mockLastTap = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});

afterEach(async () => {
  await act(async () => app.unmount());
  await takePendingInvite();
  client.clear();
  jest.useRealTimers();
});

describe('an invite link', () => {
  it('reaching someone on the profile setup goes back to the setup that is open, and the code waits', async () => {
    signInWith(started);
    await start('/');

    await followLink(`gozali://i/${CODE}`);

    expect(rootRoutes()).toEqual(['profile-setup']);
    expect(opened).toEqual(['setup']);
    await expect(takePendingInvite()).resolves.toBe(CODE);
  });

  it('opening the app on the profile setup shows the setup', async () => {
    signInWith(started);
    await start(`/i/${CODE}`);

    expect(rootRoutes()).toEqual(['profile-setup']);
    expect(opened).toEqual(['setup']);
  });

  it('opening the app signed out shows the sign-in screen', async () => {
    await start(`/i/${CODE}`);

    expect(rootRoutes()).toEqual(['welcome']);
    await expect(takePendingInvite()).resolves.toBe(CODE);
  });

  it('with a finished profile opens the home screen, which reads the code as it opens', async () => {
    signInWith(finished);
    await start(`/i/${CODE}`);

    expect(rootRoutes()).toEqual(['(app)']);
    expect(opened).toEqual(['home']);
    await expect(takePendingInvite()).resolves.toBe(CODE);
  });

  it('opening the app gets past a phone that refuses the code', async () => {
    signInWith(finished);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(FULL);

    await start(`/i/${CODE}`);

    expect(rootRoutes()).toEqual(['(app)']);
    expect(opened).toEqual(['home']);
  });

  it('opening the app signed out gets past a phone that refuses the code', async () => {
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(FULL);

    await start(`/i/${CODE}`);

    expect(rootRoutes()).toEqual(['welcome']);
  });

  it('waits with a spinner until the profile is known', async () => {
    mockSession = { user: { id: USER } };
    await start(`/i/${CODE}`);

    expect(store.getRouteInfo().pathname).toBe(`/i/${CODE}`);
    expect(app.root.findAllByType(ActivityIndicator)).toHaveLength(1);

    await act(async () => mockAnswerProfile?.({ data: started, error: null }));
    await settle();

    expect(rootRoutes()).toEqual(['profile-setup']);
  });
});

describe('an invite link reaching the app while it is running', () => {
  it('opens the join screen over the open screen, in the one copy of the app', async () => {
    await openPack();

    await followLink(`gozali://i/${CODE}`);

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appLayouts).toBe(1);
    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'join']);
    expect(opened).toEqual(['home', 'pack', `join ${CODE}`]);
    await expect(takePendingInvite()).resolves.toBeNull();
  });

  it('goes back to the open screen when the join screen closes, and then to the home screen', async () => {
    await openPack();
    await followLink(`gozali://i/${CODE}`);

    await goBack();
    expect(store.getRouteInfo().pathname).toBe('/pack/p1');
    await goBack();
    expect(store.getRouteInfo().pathname).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });

  it('leaves one listener for notifications, so a tap opens its screen once', async () => {
    await openPack();
    await followLink(`gozali://i/${CODE}`);
    expect(mockTapListeners.size).toBe(1);

    await tapNotification('/pack/p9');

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'join', 'pack/[id]/index']);
  });

  it('tapped twice leaves one join screen', async () => {
    await openPack();

    await followLink(`gozali://i/${CODE}`);
    await followLink(`gozali://i/${CODE}`);

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'join']);
  });

  it('brings its code to the join screen that is open', async () => {
    await openPack();
    await followLink(`gozali://i/${CODE}`);

    await followLink('gozali://i/EFGH6789');

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'join']);
    expect(opened.at(-1)).toBe('join EFGH6789');
    await expect(takePendingInvite()).resolves.toBeNull();
  });

  it.each([
    ['keep the code', () => jest.mocked(AsyncStorage.setItem)],
    ['read the code back', () => jest.mocked(AsyncStorage.getItem)],
  ])('opens the join screen from the link itself when the phone can not %s', async (_what, storage) => {
    await openPack();
    storage().mockRejectedValueOnce(FULL);

    await followLink(`gozali://i/${CODE}`);

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'join']);
    expect(opened.at(-1)).toBe(`join ${CODE}`);
    expect(app.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  });

  it("brings the link's own code, not an older one the phone holds and couldn't replace", async () => {
    await openPack();
    await savePendingInvite('EFGH6789');
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(FULL);

    await followLink(`gozali://i/${CODE}`);

    expect(opened.at(-1)).toBe(`join ${CODE}`);
  });

  it('with no real code in it leaves the open screen as it was', async () => {
    await openPack();

    await followLink('gozali://i/nope');

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(opened).toEqual(['home', 'pack']);
  });
});

describe('an invite link opening the app', () => {
  it('builds one copy of the app, so a notification tap opens its screen once', async () => {
    signInWith(finished);
    await start(`/i/${CODE}`);

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appLayouts).toBe(1);
    expect(mockTapListeners.size).toBe(1);

    await tapNotification('/pack/p9');
    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
  });
});

describe('a widget link reaching the app while it is running', () => {
  it('opens its screen in the one copy of the app', async () => {
    signInWith(finished);
    await start('/');

    await followLink('gozali://pack/p1');

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appLayouts).toBe(1);
    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
  });
});

describe('a notification that opens the app', () => {
  it('opens its screen once, over the home screen', async () => {
    mockLastTap = tapOn('/pack/p9');
    signInWith(finished);
    await start('/');

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(opened).toEqual(['home', 'pack']);
  });
});

describe('a notification tapped with the app open', () => {
  it('is not opened again when the app is built again later in the same run', async () => {
    signInWith(finished);
    await start('/');
    await tapNotification('/pack/p9');
    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    await goBack();

    // The server ends the session, which signs nothing out on the phone, and the person signs in again.
    await sessionBecomes(null);
    expect(rootRoutes()).toEqual(['welcome']);
    await sessionBecomes({ user: { id: USER } });

    expect(rootRoutes()).toEqual(['(app)']);
    expect(appStack()).toEqual(['index']);
  });
});

describe('a sign-in link', () => {
  it('reaching the sign-in screen goes back to the one that is open', async () => {
    await start('/');

    await followLink('gozali://auth/callback?error=access_denied');

    expect(rootRoutes()).toEqual(['welcome']);
    expect(opened).toEqual(['welcome']);
  });

  it('reaching the profile setup goes back to the one that is open', async () => {
    signInWith(started);
    await start('/');

    await followLink('gozali://auth/callback?code=one-time');

    expect(rootRoutes()).toEqual(['profile-setup']);
    expect(opened).toEqual(['setup']);
  });

  it('reaching the home screen goes back to the one that is open', async () => {
    signInWith(finished);
    await start('/');

    await followLink('gozali://auth/callback?code=one-time');

    expect(rootRoutes()).toEqual(['(app)']);
    expect(opened).toEqual(['home']);
  });

  it('reaching a pack goes back to the pack, with no home screen over it', async () => {
    await openPack();

    await followLink('gozali://auth/callback?code=one-time');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(opened).toEqual(['home', 'pack']);
  });
});

describe('a link to a screen the app does not have', () => {
  it('opening the app signed out shows the sign-in screen', async () => {
    await start('/nothing-here');

    expect(store.getRouteInfo().pathname).toBe('/welcome');
    expect(opened).toEqual(['welcome']);
  });

  it('opening the app on the profile setup shows the setup', async () => {
    signInWith(started);
    await start('/nothing-here');

    expect(store.getRouteInfo().pathname).toBe('/profile-setup');
    expect(opened).toEqual(['setup']);
  });

  it('opening the app with a finished profile shows the home screen', async () => {
    signInWith(finished);
    await start('/nothing-here');

    expect(store.getRouteInfo().pathname).toBe('/');
    expect(opened).toEqual(['home']);
  });

  it('reaching the sign-in screen goes back to the one that is open', async () => {
    await start('/');

    await followLink('gozali://nothing-here');

    expect(rootRoutes()).toEqual(['welcome']);
    expect(opened).toEqual(['welcome']);
  });

  it('reaching the profile setup goes back to the one that is open', async () => {
    signInWith(started);
    await start('/');

    await followLink('gozali://nothing-here');

    expect(rootRoutes()).toEqual(['profile-setup']);
    expect(opened).toEqual(['setup']);
  });

  it('reaching the home screen goes back to the one that is open', async () => {
    signInWith(finished);
    await start('/');

    await followLink('gozali://nothing-here');

    expect(rootRoutes()).toEqual(['(app)']);
    expect(opened).toEqual(['home']);
  });

  it('reaching a pack goes back to the pack, with no home screen over it', async () => {
    await openPack();

    await followLink('gozali://nothing-here');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(opened).toEqual(['home', 'pack']);
  });

  it('includes an invite link with no code in it', async () => {
    signInWith(finished);
    await start('/');

    await followLink('gozali://i/');

    expect(rootRoutes()).toEqual(['(app)']);
    expect(opened).toEqual(['home']);
    await expect(takePendingInvite()).resolves.toBeNull();
  });
});

describe('the development sign-in', () => {
  const asRelease = () => jest.replaceProperty(globalThis as unknown as { __DEV__: boolean }, '__DEV__', false);
  const fields = () => app.root.findAll((node) => node.type === 'TextInput');

  it('is a form in a development build', async () => {
    await start('/dev-login');

    expect(rootRoutes()).toEqual(['dev-login']);
    expect(fields()).toHaveLength(1);
  });

  it('is only the way to the sign-in screen in a release build', async () => {
    const release = asRelease();
    await start('/dev-login');
    release.restore();

    expect(rootRoutes()).toEqual(['welcome']);
    expect(opened).toEqual(['welcome']);
    expect(fields()).toEqual([]);
  });

  it('is closed to someone on the profile setup in a release build', async () => {
    const release = asRelease();
    signInWith(started);
    await start('/dev-login');
    release.restore();

    expect(store.getRouteInfo().pathname).toBe('/profile-setup');
    expect(opened).toEqual(['setup']);
    expect(fields()).toEqual([]);
  });

  it('is closed to a finished account in a release build', async () => {
    const release = asRelease();
    signInWith(finished);
    await start('/dev-login');
    release.restore();

    expect(store.getRouteInfo().pathname).toBe('/');
    expect(opened).toEqual(['home']);
    expect(fields()).toEqual([]);
  });

  it('is closed to a link arriving in a running release build', async () => {
    const release = asRelease();
    await start('/');
    await followLink('gozali://dev-login');
    release.restore();

    expect(rootRoutes().at(-1)).toBe('welcome');
    expect(fields()).toEqual([]);
  });
});
