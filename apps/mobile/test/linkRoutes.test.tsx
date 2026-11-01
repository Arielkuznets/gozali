import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { useEffect } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import NotFound from '@/app/+not-found';
import AuthCallback from '@/app/auth/callback';
import DevLoginRoute from '@/app/dev-login';
import InviteLinkScreen from '@/app/i/[code]';
import { takePendingInvite } from '@/features/packs/invites';
import { isProfileComplete, useProfile, type Profile } from '@/features/profile/useProfile';

// The real router and the real link routes, under guards like the root layout's. A link reaches
// the router the way it does on a phone: through the listener on expo-linking.
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
let mockSession: { user: { id: string } } | null = null;
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: mockSession, loading: false }) }));
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

const routes = {
  _layout: { default: RootLayout },
  '(app)/_layout': { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/index': { default: () => <Opens name="home" /> },
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

function signInWith(profile: Profile) {
  mockSession = { user: { id: USER } };
  client.setQueryData(['profile', USER], profile);
}

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  opened.length = 0;
  mockSession = null;
  mockAnswerProfile = null;
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
