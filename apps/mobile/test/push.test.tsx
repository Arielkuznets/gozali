import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';

import { useSignedOutSync } from '@/features/profile/useProfile';
import { registerPushToken, unregisterPushToken } from '@/lib/push';

const TOKEN = 'ExponentPushToken[phone]';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project' } } } },
}));
let mockGranted: boolean;
const mockReadToken = jest.fn();
const mockPrompt = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getPermissionsAsync: async () => ({ granted: mockGranted, canAskAgain: true }),
  requestPermissionsAsync: () => mockPrompt(),
  getExpoPushTokenAsync: () => mockReadToken(),
}));

const mockRpc = jest.fn();
const mockTableDelete = jest.fn();
let mockStoredSession: object | null;
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  requireSupabase: () => ({
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    from: (table: string) => ({ delete: () => ({ eq: (_column: string, value: string) => mockTableDelete(table, value) }) }),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'noa' } } } }) },
  }),
  storedSession: async () => mockStoredSession,
}));

let mockAuth: { session: object | null; loading: boolean };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

type Connection = { isConnected: boolean | null };
const mockNetwork = new Set<(state: Connection) => void>();
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (listener: (state: Connection) => void) => {
    mockNetwork.add(listener);
    return () => mockNetwork.delete(listener);
  },
}));

const offline = { code: '', message: 'TypeError: Network request failed' };
const refused = { code: 'PGRST301', message: 'No suitable key or wrong key type' };
const noFunction = { code: 'PGRST202', message: 'Could not find the function public.forget_push_token(device_token)' };

/** How the server answers each call, by function; anything not named goes through. */
const answer = (answers: Record<string, unknown>) =>
  mockRpc.mockImplementation(async (name: string) => ({ error: answers[name] ?? null }));
const forgotten = () => mockRpc.mock.calls.filter(([name]) => name === 'forget_push_token').map(([, args]) => args.device_token);
const registrations = () => mockRpc.mock.calls.filter(([name]) => name === 'register_push_token').length;
const kept = () => AsyncStorage.getItem('gozali.push-forget');

const settle = () => new Promise((resolve) => setImmediate(resolve));

function SignedOutSync() {
  useSignedOutSync();
  return null;
}

async function startApp() {
  const app = await act(async () => {
    const rendered = create(<SignedOutSync />);
    await settle();
    return rendered;
  });
  return app;
}

const appStates = new Set<(state: AppStateStatus) => void>();

async function comeBackToApp() {
  await act(async () => {
    appStates.forEach((listener) => listener('active'));
    await settle();
  });
}

async function connectionChanges(isConnected: boolean) {
  await act(async () => {
    mockNetwork.forEach((listener) => listener({ isConnected }));
    await settle();
  });
}

/** Registered, then signed out without a connection. */
async function signOutOffline() {
  await registerPushToken();
  answer({ forget_push_token: offline });
  await unregisterPushToken();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth = { session: null, loading: false };
  mockGranted = true;
  mockStoredSession = null;
  mockReadToken.mockReset().mockResolvedValue({ data: TOKEN });
  mockPrompt.mockReset();
  mockRpc.mockReset();
  answer({});
  mockTableDelete.mockReset().mockResolvedValue({ error: null });
  appStates.clear();
  mockNetwork.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStates.add(listener);
    return { remove: () => appStates.delete(listener) };
  });
});

describe('signing out', () => {
  it('has the server forget the token by its value, which takes no session', async () => {
    await registerPushToken();
    await unregisterPushToken();
    expect(forgotten()).toEqual([TOKEN]);
    expect(mockTableDelete).not.toHaveBeenCalled();
    expect(await kept()).toBeNull();
  });

  it('keeps the token when the call fails, and the next start sends it', async () => {
    await signOutOffline();
    expect(forgotten()).toEqual([TOKEN]);
    expect(await kept()).toBe(TOKEN);

    answer({});
    await startApp();
    expect(forgotten()).toEqual([TOKEN, TOKEN]);
    expect(await kept()).toBeNull();
  });

  it('keeps the token when the server refuses', async () => {
    await registerPushToken();
    answer({ forget_push_token: refused });
    await unregisterPushToken();
    expect(await kept()).toBe(TOKEN);
    expect(mockTableDelete).not.toHaveBeenCalled();
  });

  it('sends a kept token on the next try too, when the phone stayed signed in', async () => {
    await signOutOffline();
    answer({});
    await unregisterPushToken();
    expect(forgotten()).toEqual([TOKEN, TOKEN]);
    expect(await kept()).toBeNull();
  });
});

describe('on a server without forget_push_token', () => {
  it("deletes the row with the account's session, as before", async () => {
    await registerPushToken();
    answer({ forget_push_token: noFunction });
    await unregisterPushToken();
    expect(mockTableDelete).toHaveBeenCalledWith('push_tokens', TOKEN);
    expect(await kept()).toBeNull();
  });

  it('keeps the token when that is refused too, until the function arrives', async () => {
    await registerPushToken();
    answer({ forget_push_token: noFunction });
    mockTableDelete.mockResolvedValue({ error: { code: '42501', message: 'permission denied for table push_tokens' } });
    await unregisterPushToken();
    expect(await kept()).toBe(TOKEN);

    answer({});
    await startApp();
    expect(await kept()).toBeNull();
  });
});

describe('while signed out', () => {
  it('tries again on coming back to the app, until it worked', async () => {
    await signOutOffline();
    await startApp();
    expect(await kept()).toBe(TOKEN);

    answer({});
    await comeBackToApp();
    expect(forgotten()).toHaveLength(3);
    expect(await kept()).toBeNull();

    await comeBackToApp();
    expect(forgotten()).toHaveLength(3);
  });

  it('tries again when the connection comes back with the app left open', async () => {
    await signOutOffline();
    await startApp();
    expect(await kept()).toBe(TOKEN);

    answer({});
    await connectionChanges(true);

    expect(forgotten()).toHaveLength(3);
    expect(await kept()).toBeNull();
  });

  it('asks nothing of the server when the connection goes', async () => {
    await signOutOffline();
    await startApp();
    mockRpc.mockClear();

    await connectionChanges(false);

    expect(forgotten()).toEqual([]);
    expect(await kept()).toBe(TOKEN);
  });

  it('forgets a token whose session ended without the app signing out', async () => {
    await registerPushToken();
    await startApp();
    expect(forgotten()).toEqual([TOKEN]);
  });

  it("doesn't touch the token with someone signed in, or before that is known", async () => {
    await signOutOffline();
    answer({});
    mockRpc.mockClear();

    mockAuth = { session: { access_token: 'token' }, loading: false };
    await startApp();
    await comeBackToApp();
    mockAuth = { session: null, loading: true };
    await startApp();

    expect(forgotten()).toEqual([]);
    expect(await kept()).toBe(TOKEN);
  });

  it('stops once someone signs in', async () => {
    await signOutOffline();
    const app = await startApp();
    mockRpc.mockClear();

    mockAuth = { session: { access_token: 'token' }, loading: false };
    await act(async () => app.update(<SignedOutSync />));
    await comeBackToApp();
    await connectionChanges(true);

    expect(forgotten()).toEqual([]);
  });
});

describe('a phone that signed out offline on a build that kept no copy of its token', () => {
  it('reads the token once and has the server forget it, with no prompt', async () => {
    await startApp();

    expect(forgotten()).toEqual([TOKEN]);
    expect(await kept()).toBeNull();
    expect(mockPrompt).not.toHaveBeenCalled();

    await startApp();
    await comeBackToApp();
    await connectionChanges(true);

    expect(forgotten()).toEqual([TOKEN]);
    expect(mockReadToken).toHaveBeenCalledTimes(1);
  });

  it('reads nothing without permission already there, and never asks for it', async () => {
    mockGranted = false;

    await startApp();
    await comeBackToApp();
    await connectionChanges(true);

    expect(mockReadToken).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
    expect(forgotten()).toEqual([]);
  });

  it('looks again if the permission comes later', async () => {
    mockGranted = false;
    await startApp();

    mockGranted = true;
    await comeBackToApp();

    expect(forgotten()).toEqual([TOKEN]);
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('tries again when the token could not be read without a connection', async () => {
    mockReadToken.mockRejectedValueOnce(new Error('Error encountered while fetching Expo token'));
    await startApp();
    expect(forgotten()).toEqual([]);

    await connectionChanges(true);

    expect(forgotten()).toEqual([TOKEN]);
  });

  it('keeps the token for the next try when the server gets no word of it', async () => {
    answer({ forget_push_token: offline });
    await startApp();
    expect(await kept()).toBe(TOKEN);

    answer({});
    await comeBackToApp();

    expect(forgotten()).toEqual([TOKEN, TOKEN]);
    expect(await kept()).toBeNull();
    expect(mockReadToken).toHaveBeenCalledTimes(1);
  });

  it('leaves the token alone when someone signed in while it was being read', async () => {
    let read: (token: { data: string }) => void = () => undefined;
    mockReadToken.mockImplementation(() => new Promise((resolve) => (read = resolve)));
    await startApp();

    mockStoredSession = { user: { id: 'noa' } };
    await act(async () => {
      read({ data: TOKEN });
      await settle();
    });

    expect(forgotten()).toEqual([]);
    expect(await kept()).toBeNull();
  });

  it("doesn't replace a token it already holds", async () => {
    await AsyncStorage.setItem('gozali.push-forget', 'ExponentPushToken[older]');
    answer({ forget_push_token: offline });
    mockReadToken.mockResolvedValue({ data: 'ExponentPushToken[newer]' });

    await startApp();

    expect(await kept()).toBe('ExponentPushToken[older]');
    expect(mockReadToken).not.toHaveBeenCalled();
  });

  it('has nothing to look for once the phone registered here', async () => {
    await registerPushToken();
    await unregisterPushToken();
    mockRpc.mockClear();
    mockReadToken.mockClear();

    await startApp();

    expect(mockReadToken).not.toHaveBeenCalled();
    expect(forgotten()).toEqual([]);
  });
});

describe('registering again', () => {
  it('clears the kept token: the server holds it on purpose now', async () => {
    await signOutOffline();
    answer({});
    await registerPushToken();
    expect(await kept()).toBeNull();
  });

  it('keeps it when the register fails: the server still has the old row', async () => {
    await signOutOffline();
    answer({ register_push_token: offline });
    await registerPushToken();
    expect(await kept()).toBe(TOKEN);
  });

  it('goes out only after a forget under way has its answer, which could otherwise undo it', async () => {
    await signOutOffline();
    let answerForget: () => void = () => undefined;
    mockRpc.mockImplementation((name: string) =>
      name === 'forget_push_token'
        ? new Promise((resolve) => {
            answerForget = () => resolve({ error: null });
          })
        : Promise.resolve({ error: null }),
    );
    mockRpc.mockClear();

    const forget = unregisterPushToken();
    await settle();
    const register = registerPushToken();
    await settle();
    expect(registrations()).toBe(0);

    answerForget();
    await Promise.all([forget, register]);
    expect(registrations()).toBe(1);
    expect(await kept()).toBeNull();
  });

  describe('with two forgets under way', () => {
    let answers: (() => void)[];
    let first: Promise<void>;
    let second: Promise<void>;

    beforeEach(async () => {
      await signOutOffline();
      answers = [];
      mockRpc.mockImplementation((name: string) =>
        name === 'forget_push_token'
          ? new Promise((resolve) => answers.push(() => resolve({ error: null })))
          : Promise.resolve({ error: null }),
      );
      mockRpc.mockClear();
      first = unregisterPushToken();
      await settle();
      second = unregisterPushToken();
      await settle();
    });

    it('goes out only after both have their answers, whichever comes last', async () => {
      answers[1]!();
      await second;

      const register = registerPushToken();
      await settle();
      expect(registrations()).toBe(0);

      answers[0]!();
      await Promise.all([first, register]);
      expect(registrations()).toBe(1);
    });

    it('leaves a forget waiting only for its own answer', async () => {
      answers[1]!();
      await expect(second).resolves.toBeUndefined();

      answers[0]!();
      await first;
    });
  });
});
