import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import WelcomeScreen from '@/app/welcome';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';

// The pet's drawing needs Reanimated, which doesn't run here.
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationButton: 'AppleAuthenticationButton',
  AppleAuthenticationButtonType: { CONTINUE: 1 },
  AppleAuthenticationButtonStyle: { BLACK: 2 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: () => Promise.resolve({ error: null }) },
  requireSupabase: () => ({ auth: { signInWithIdToken: () => Promise.resolve({ error: null }) } }),
  NotConfiguredError: class extends Error {},
}));

const cancelled = Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' });
const failed = Object.assign(new Error('The authorization attempt failed for an unknown reason'), { code: 'ERR_REQUEST_UNKNOWN' });
const rejectAfter = (ms: number, error: unknown) => () => new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
let tree: ReactTestRenderer;
let client: QueryClient;

beforeEach(async () => {
  await AsyncStorage.setItem(ONBOARDED_KEY, '1');
  globalThis.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  alert.mockClear();
  mockSignInAsync.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <WelcomeScreen />
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  act(() => tree.unmount());
  client.clear();
});

/** Taps Continue with Apple and waits for Apple's answer. */
async function tapApple(waitMs: number) {
  const button = tree.root.find((node) => (node.type as unknown) === 'AppleAuthenticationButton');
  await act(async () => {
    button.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  });
}

const shown = () => JSON.stringify(tree.toJSON());

describe('signing in with Apple', () => {
  it('says so when Apple cancels before any sheet could show', async () => {
    mockSignInAsync.mockImplementation(rejectAfter(50, cancelled));
    await tapApple(100);
    expect(alert).toHaveBeenCalledWith("Sign in with Apple didn't open. Please try again.", 'Code: ERR_REQUEST_CANCELED');
  });

  it("says sign-in didn't finish once someone closed the sheet, without an alert", async () => {
    mockSignInAsync.mockImplementation(rejectAfter(1200, cancelled));
    await tapApple(1300);
    expect(alert).not.toHaveBeenCalled();
    expect(shown()).toContain("Sign-in didn't finish. Tap Continue with Apple to try again.");
  });

  it('says it went wrong, with the code, for any other error', async () => {
    mockSignInAsync.mockImplementation(rejectAfter(50, failed));
    await tapApple(100);
    expect(alert).toHaveBeenCalledWith("Sign-in didn't work. Please try again.", 'Code: ERR_REQUEST_UNKNOWN');
    expect(shown()).not.toContain("Sign-in didn't finish");
  });
});
