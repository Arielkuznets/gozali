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
jest.mock('expo-linking', () => ({ createURL: (path: string) => `gozali://${path}` }));
const mockOpenAuthSession = jest.fn();
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args) }));
let mockAppleWebSignIn = false;
const mockConfig = () => ({
  min_version: '1.0.0',
  ios_url: null,
  android_url: null,
  apple_revocation: false,
  apple_web_sign_in: mockAppleWebSignIn,
});
const mockSignInWithOAuth = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ error: null }),
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: mockConfig(), error: null }) }) }),
  },
  requireSupabase: () => ({
    auth: {
      signInWithIdToken: () => Promise.resolve({ error: null }),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    },
  }),
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
  mockOpenAuthSession.mockReset().mockResolvedValue({ type: 'cancel' });
  mockSignInWithOAuth.mockReset().mockResolvedValue({ data: { url: 'https://auth.test/authorize?provider=apple' }, error: null });
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
const browserButtons = () => tree.root.findAll((node) => node.props.label === 'Continue with Apple in the browser');

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

describe("Apple's sign-in page as a fallback", () => {
  afterEach(() => {
    mockAppleWebSignIn = false;
  });

  /** Opens the welcome screen again, with the server's switch as given. */
  async function reopen(appleWebSignIn: boolean) {
    act(() => tree.unmount());
    client.clear();
    mockAppleWebSignIn = appleWebSignIn;
    await act(async () => {
      tree = create(
        <QueryClientProvider client={client}>
          <WelcomeScreen />
        </QueryClientProvider>,
      );
    });
  }

  it("is offered once Apple's sheet failed, while the server allows it", async () => {
    await reopen(true);
    expect(browserButtons()).toHaveLength(0);
    mockSignInAsync.mockImplementation(rejectAfter(50, cancelled));
    await tapApple(100);
    const [button] = browserButtons();
    expect(button).toBeDefined();

    await act(async () => {
      button.props.onPress();
    });
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'apple' }));
    expect(mockOpenAuthSession).toHaveBeenCalledWith('https://auth.test/authorize?provider=apple', 'gozali://auth/callback');
    // Closing the browser leaves the way open to try again.
    expect(browserButtons()).not.toHaveLength(0);
  });

  it('is not offered while the server keeps it off', async () => {
    await reopen(false);
    mockSignInAsync.mockImplementation(rejectAfter(50, failed));
    await tapApple(100);
    expect(browserButtons()).toHaveLength(0);
  });
});
