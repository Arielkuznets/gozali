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
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: async () => ({ granted: true }),
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[phone]' }),
}));

const mockRpc = jest.fn();
const mockTableDelete = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  requireSupabase: () => ({
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    from: (table: string) => ({ delete: () => ({ eq: (_column: string, value: string) => mockTableDelete(table, value) }) }),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'noa' } } } }) },
  }),
}));

let mockAuth: { session: object | null; loading: boolean };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

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

/** Registered, then signed out without a connection. */
async function signOutOffline() {
  await registerPushToken();
  answer({ forget_push_token: offline });
  await unregisterPushToken();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth = { session: null, loading: false };
  mockRpc.mockReset();
  answer({});
  mockTableDelete.mockReset().mockResolvedValue({ error: null });
  appStates.clear();
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
});
