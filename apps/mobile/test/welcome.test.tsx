import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, AppState, Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import WelcomeScreen from '@/app/welcome';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';
import { suggestName, suggestedName } from '@/features/profile/suggestedName';

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
const mockSignInWithIdToken = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: mockConfig(), error: null }) }) }),
  },
  requireSupabase: () => ({
    auth: {
      signInWithIdToken: (...args: unknown[]) => mockSignInWithIdToken(...args),
      signInWithOAuth: (...args: unknown[]) => mockSignInWithOAuth(...args),
    },
  }),
  NotConfiguredError: class extends Error {},
}));
// The real reports, a new copy for each test: a test is a run of the app, and a run keeps count.
let mockRun: typeof import('@/lib/reportError');
jest.mock('@/lib/reportError', () => new Proxy({}, { get: (_module, name) => Reflect.get(mockRun, name) }));

const cancelled =Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' });
const failed = Object.assign(new Error('The authorization attempt failed for an unknown reason'), { code: 'ERR_REQUEST_UNKNOWN' });
const rejectAfter = (ms: number, error: unknown) => () => new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));
const unanswered = () => new Promise(() => undefined);

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
let tree: ReactTestRenderer;
let client: QueryClient;

beforeEach(async () => {
  jest.isolateModules(() => {
    mockRun = jest.requireActual<typeof import('@/lib/reportError')>('@/lib/reportError');
  });
  await AsyncStorage.setItem(ONBOARDED_KEY, '1');
  globalThis.fetch = jest.fn(async () => ({ ok: false })) as unknown as typeof fetch;
  alert.mockClear();
  mockSignInAsync.mockReset();
  mockRpc.mockReset().mockResolvedValue({ error: null });
  mockSignInWithIdToken.mockReset().mockResolvedValue({ error: null });
  suggestName(null);
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

const appleButton = () => tree.root.find((node) => (node.type as unknown) === 'AppleAuthenticationButton');

/** Taps Continue with Apple and waits for Apple's answer. */
async function tapApple(waitMs: number) {
  await act(async () => {
    appleButton().props.onPress();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  });
}

// For fake timers: the tap and the clock moving on are separate steps.
const tap = () => act(async () => void appleButton().props.onPress());
const wait = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

const shown = () => JSON.stringify(tree.toJSON());
const browserButtons = () => tree.root.findAll((node) => node.props.label === 'Continue with Apple in the browser');
/** What reached the developer through report_sign_in_problem. */
const reports = (): string[] => mockRpc.mock.calls.map(([, args]) => args.problem);

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

describe('the name Apple sends only the first time', () => {
  const withName = (givenName: string | null, familyName: string | null) => ({ identityToken: 'token', fullName: { givenName, familyName } });

  it('is kept for the setup', async () => {
    mockSignInAsync.mockResolvedValue(withName('Noa', 'Levi'));
    await tapApple(10);
    expect(suggestedName()).toBe('Noa Levi');
  });

  it('survives a first try the server failed, for the second try that comes without it', async () => {
    mockSignInAsync.mockResolvedValueOnce(withName('Noa', 'Levi')).mockResolvedValueOnce(withName(null, null));
    mockSignInWithIdToken.mockResolvedValueOnce({ error: new TypeError('Network request failed') });

    await tapApple(10);
    expect(alert).toHaveBeenCalledTimes(1);
    await tapApple(10);

    expect(mockSignInWithIdToken).toHaveBeenCalledTimes(2);
    expect(suggestedName()).toBe('Noa Levi');
  });

  it('is not replaced by a name of nothing but spaces', async () => {
    mockSignInAsync.mockResolvedValueOnce(withName('Noa', null)).mockResolvedValueOnce(withName(' ', ' '));
    await tapApple(10);
    await tapApple(10);
    expect(suggestedName()).toBe('Noa');
  });

  it('gives way to the name of a later first sign-in', async () => {
    mockSignInAsync.mockResolvedValueOnce(withName('Noa', 'Levi')).mockResolvedValueOnce(withName('Dan', null));
    await tapApple(10);
    await tapApple(10);
    expect(suggestedName()).toBe('Dan');
  });
});

describe("Apple's sign-in page as a fallback", () => {
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

describe('a report of a sign-in that did not finish', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ['a sheet that never opened', 50],
    ['a sheet someone closed', 12_000],
  ])('gives the time since the tap for %s', async (_sheet, ms) => {
    mockSignInAsync.mockImplementation(rejectAfter(ms, cancelled));
    await tap();
    await wait(ms);
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain(`apple ERR_REQUEST_CANCELED after ${ms} ms: The user canceled`);
  });

  it('gives the time for any other error too', async () => {
    mockSignInAsync.mockImplementation(rejectAfter(300, failed));
    await tap();
    await wait(300);
    expect(reports()[0]).toContain('apple ERR_REQUEST_UNKNOWN after 300 ms: ');
  });

  it('gives the time when nothing answered, and again if the answer comes later', async () => {
    let close = (_error: unknown) => {};
    mockSignInAsync.mockImplementation(() => new Promise((_resolve, reject) => (close = reject)));
    await tap();
    await wait(30_000);
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain('apple no code after 15000 ms: ');

    await act(async () => close(cancelled));
    expect(reports()[1]).toContain('apple ERR_REQUEST_CANCELED after 30000 ms: ');
  });
});

describe('a request Apple leaves unanswered', () => {
  const dimmed = () => shown().includes('"pointerEvents":"none"');

  /** A request whose answer the test gives by hand. */
  function answeredByHand() {
    const request = { answer: (_credential: unknown) => {}, fail: (_error: unknown) => {} };
    mockSignInAsync.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          request.answer = resolve;
          request.fail = reject;
        }),
    );
    return request;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    AppState.currentState = 'active';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives the button back after 15 s, with one report and no alert', async () => {
    mockSignInAsync.mockImplementation(unanswered);
    await tap();
    await wait(14_999);
    expect(dimmed()).toBe(true);
    expect(reports()).toEqual([]);

    await wait(1);
    expect(dimmed()).toBe(false);
    expect(shown()).toContain("Sign-in didn't finish. Tap Continue with Apple to try again.");
    expect(alert).not.toHaveBeenCalled();
    expect(reports()).toHaveLength(1);

    await wait(60 * 60_000);
    expect(reports()).toHaveLength(1);
  });

  it('says what state the app was in', async () => {
    mockSignInAsync.mockImplementation(unanswered);
    AppState.currentState = 'inactive';
    await tap();
    await wait(15_000);
    expect(reports()[0]).toContain('app inactive');
  });

  it('reports a wait with the app not active once a run, and every answer to it', async () => {
    mockSignInAsync.mockImplementation(rejectAfter(20_000, cancelled));
    AppState.currentState = 'inactive';
    for (let tries = 0; tries < 3; tries += 1) {
      await tap();
      await wait(20_000);
    }
    expect(reports()).toEqual([
      expect.stringContaining('apple no code after 15000 ms: No answer yet, app inactive'),
      expect.stringContaining('apple ERR_REQUEST_CANCELED after 20000 ms: '),
      expect.stringContaining('apple ERR_REQUEST_CANCELED after 20000 ms: '),
      expect.stringContaining('apple ERR_REQUEST_CANCELED after 20000 ms: '),
    ]);
  });

  it('counts a run of the app, not an opening of this screen', async () => {
    mockSignInAsync.mockImplementation(unanswered);
    AppState.currentState = 'background';
    await tap();
    await wait(15_000);
    await reopen(false);
    await tap();
    await wait(15_000);
    expect(reports()).toEqual([expect.stringContaining('No answer yet, app background')]);
  });

  it('still reports a silence with the app active after a wait that was not', async () => {
    mockSignInAsync.mockImplementation(unanswered);
    AppState.currentState = 'inactive';
    await tap();
    await wait(15_000);
    await tap();
    await wait(15_000);
    AppState.currentState = 'active';
    await tap();
    await wait(15_000);
    expect(reports()).toEqual([
      expect.stringContaining('No answer yet, app inactive'),
      expect.stringContaining('No answer yet, app active'),
    ]);
  });

  it('lets a new tap ask again, with a wait of its own', async () => {
    mockSignInAsync.mockImplementation(unanswered);
    await tap();
    await wait(15_000);
    await tap();
    expect(mockSignInAsync).toHaveBeenCalledTimes(2);
    expect(dimmed()).toBe(true);
    expect(shown()).not.toContain("Sign-in didn't finish");

    await wait(14_999);
    expect(dimmed()).toBe(true);
    await wait(1);
    expect(dimmed()).toBe(false);
    expect(reports()).toHaveLength(2);
  });

  it('opens the way to the browser page, which has no wait of its own', async () => {
    await reopen(true);
    mockSignInAsync.mockImplementation(unanswered);
    mockOpenAuthSession.mockImplementation(unanswered);
    await tap();
    await wait(15_000);

    const [button] = browserButtons();
    await act(async () => void button.props.onPress());
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(1);

    await wait(60 * 60_000);
    expect(reports()).toHaveLength(1);
    expect(browserButtons()[0].props.loading).toBe(true);
  });

  it('still signs in when the answer comes late', async () => {
    const request = answeredByHand();
    await tap();
    await wait(20_000);
    await act(async () => request.answer({ identityToken: 'token', fullName: null }));
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'token' });
    expect(alert).not.toHaveBeenCalled();
  });

  it('takes a late close of the sheet like any other, and reports it too', async () => {
    const request = answeredByHand();
    await tap();
    await wait(20_000);
    await act(async () => request.fail(cancelled));
    expect(shown()).toContain("Sign-in didn't finish. Tap Continue with Apple to try again.");
    expect(alert).not.toHaveBeenCalled();
    expect(reports()).toHaveLength(2);
    expect(dimmed()).toBe(false);
  });

  it('stops the clock once Apple answers, however long the server then takes', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'token', fullName: null });
    mockSignInWithIdToken.mockImplementation(unanswered);
    await tap();
    await wait(20_000);
    expect(reports()).toEqual([]);
    expect(shown()).not.toContain("Sign-in didn't finish");
    expect(dimmed()).toBe(true);
  });

  it('takes the button back from a wait that ran out once the sheet answers', async () => {
    const request = answeredByHand();
    mockSignInWithIdToken.mockImplementation(unanswered);
    await tap();
    await wait(20_000);
    expect(shown()).toContain("Sign-in didn't finish");
    expect(dimmed()).toBe(false);

    await act(async () => request.answer({ identityToken: 'token', fullName: null }));
    expect(shown()).not.toContain("Sign-in didn't finish");
    expect(dimmed()).toBe(true);

    await tap();
    expect(mockSignInAsync).toHaveBeenCalledTimes(1);
  });

  it('gives the button back when the server turns down an answer that came late', async () => {
    const request = answeredByHand();
    mockSignInWithIdToken.mockResolvedValue({ error: new TypeError('Network request failed') });
    await tap();
    await wait(20_000);
    await act(async () => request.answer({ identityToken: 'token', fullName: null }));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(dimmed()).toBe(false);
  });

  it('leaves a newer tap on the browser page alone when the sheet answers after all', async () => {
    await reopen(true);
    const request = answeredByHand();
    mockOpenAuthSession.mockImplementation(unanswered);
    mockSignInWithIdToken.mockImplementation(unanswered);
    await tap();
    await wait(15_000);
    const [button] = browserButtons();
    await act(async () => void button.props.onPress());

    await act(async () => request.answer({ identityToken: 'token', fullName: null }));
    expect(browserButtons()[0].props.loading).toBe(true);
    expect(dimmed()).toBe(false);
  });

  it("keeps an older tap's late failure away from a newer tap, and reports how it ended", async () => {
    const first = answeredByHand();
    mockSignInAsync.mockImplementation(unanswered);
    await tap();
    await wait(15_000);
    await tap();
    await act(async () => first.fail(failed));

    expect(dimmed()).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(reports()).toHaveLength(2);
    expect(reports()[1]).toContain('apple ERR_REQUEST_UNKNOWN after 15000 ms: ');
    await tap();
    expect(mockSignInAsync).toHaveBeenCalledTimes(2);

    await wait(15_000);
    expect(dimmed()).toBe(false);
    expect(reports()).toHaveLength(3);
  });

  it('stops waiting once a sign-in answers', async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: 'token', fullName: null });
    await tap();
    await wait(60_000);
    expect(reports()).toEqual([]);
    expect(dimmed()).toBe(false);
  });

  it('stops waiting once a failure answers, and reports only that', async () => {
    mockSignInAsync.mockRejectedValue(failed);
    await tap();
    await wait(60_000);
    expect(reports()).toHaveLength(1);
    expect(reports()[0]).toContain('ERR_REQUEST_UNKNOWN');
  });

  it('has no wait on Android, where Apple signs in through a browser that can be closed', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    await reopen(false);
    mockOpenAuthSession.mockImplementation(unanswered);
    const [button] = tree.root.findAll((node) => node.props.label === 'Continue with Apple');
    await act(async () => void button.props.onPress());
    await wait(60 * 60_000);
    os.restore();
    expect(mockOpenAuthSession).toHaveBeenCalledTimes(1);
    expect(reports()).toEqual([]);
    expect(shown()).not.toContain("Sign-in didn't finish");
  });
});
