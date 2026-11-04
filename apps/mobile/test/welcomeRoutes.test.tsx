import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import OnboardingScreen from '@/app/onboarding';
import WelcomeScreen from '@/app/welcome';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';

// The real router with the real welcome screen and rules, under the root layout's guard for
// someone signed out.
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
}));
jest.mock('@/lib/supabase', () => ({ supabase: null, NotConfiguredError: class extends Error {} }));
// What the app knows for the run, a new copy for each test: a test is a start of the app.
let mockRun: typeof import('@/features/profile/onboarding');
jest.mock('@/features/profile/onboarding', () => new Proxy({}, { get: (_module, name) => Reflect.get(mockRun, name) }));

const routes = {
  _layout: {
    default: () => (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard>
          <Stack.Screen name="welcome" />
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
      </Stack>
    ),
  },
  welcome: { default: WelcomeScreen },
  onboarding: { default: OnboardingScreen },
};

const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
let app: ReactTestRenderer;
let client: QueryClient;

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

const pathname = () => store.getRouteInfo().pathname;
const shown = () => JSON.stringify(app.toJSON());

async function press(text: string) {
  await act(async () => {
    const [button] = app.root.findAll(
      (node) =>
        typeof node.type !== 'string' &&
        node.props.onPress &&
        (node.props.label === text || node.findAll((child) => child.props.children === text).length > 0),
    );
    button?.props.onPress();
  });
  await settle();
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.isolateModules(() => {
    mockRun = jest.requireActual<typeof import('@/features/profile/onboarding')>('@/features/profile/onboarding');
  });
  await AsyncStorage.clear();
  jest.mocked(AsyncStorage.setItem).mockImplementation(write);
  globalThis.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => app.unmount());
  client.clear();
  jest.useRealTimers();
});

describe('a first launch', () => {
  it('shows the rules before sign-in, and sign-in once they were seen', async () => {
    await start('/welcome');
    expect(pathname()).toBe('/onboarding');

    await press('Skip');

    expect(pathname()).toBe('/welcome');
    expect(await AsyncStorage.getItem(ONBOARDED_KEY)).toBe('1');
  });

  describe('on a phone that refuses to note that the rules were seen', () => {
    beforeEach(() => {
      jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
        if (key === ONBOARDED_KEY) throw new Error('database or disk is full');
        return write(key, value);
      });
    });

    it('stays on sign-in after Skip', async () => {
      await start('/welcome');
      expect(pathname()).toBe('/onboarding');

      await press('Skip');

      expect(pathname()).toBe('/welcome');
      expect(shown()).not.toContain('Feed me with a photo');
    });

    it("stays on sign-in after Let's go", async () => {
      await start('/welcome');
      for (let card = 1; card < 4; card++) await press('Next');

      await press("Let's go");

      expect(pathname()).toBe('/welcome');
      expect(shown()).not.toContain('Dress me up');
    });

    it('shows the rules again at the next launch', async () => {
      await start('/welcome');
      await press('Skip');
      act(() => app.unmount());
      jest.isolateModules(() => {
        mockRun = jest.requireActual<typeof import('@/features/profile/onboarding')>('@/features/profile/onboarding');
      });

      await start('/welcome');

      expect(pathname()).toBe('/onboarding');
    });
  });
});
