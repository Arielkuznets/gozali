import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AppText } from '@/components/AppText';

// The real settings screen, auth-js and the app's own client and auth provider, against a stand-in
// for the server. What the phone keeps for the account is left out: it isn't what's tested here.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

jest.mock('expo-router', () => ({ router: { push: () => undefined } }));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({}));
jest.mock('@bacons/apple-targets', () => ({ ExtensionStorage: class {} }));
jest.mock('@/features/feeds/queue', () => ({ forgetFeedsOf: async () => undefined }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined, resumeWidgets: () => undefined }));
jest.mock('@/lib/notifications', () => ({
  clearNotifications: async () => undefined,
  useNotificationPermission: () => ({ permission: 'granted', request: async () => undefined }),
}));
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));

// Required here, for the environment above to be in place first.
const { AUTH_STORAGE_KEY, requireSupabase } = jest.requireActual<typeof import('@/lib/supabase')>('@/lib/supabase');
const { AuthProvider } = jest.requireActual<typeof import('@/features/auth/AuthProvider')>('@/features/auth/AuthProvider');
const { default: SettingsScreen } = jest.requireActual<typeof import('@/app/(app)/settings')>('@/app/(app)/settings');

const NOT_DELETED = "The account wasn't deleted. Please try again.";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };

let sessions = 0;

/** A session; auth-js remembers a refused refresh by its token, so each is new. */
function sessionOf(expires_at: number) {
  sessions += 1;
  return { access_token: 'noa-access', refresh_token: `noa-refresh-${sessions}`, token_type: 'bearer', expires_in: 3600, expires_at, user: USER };
}

/** Whether the server still has the account. */
let accountGone: boolean;

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', date: new Date().toUTCString() } });
}

function server(url: URL) {
  switch (url.pathname) {
    case '/auth/v1/token':
      return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    case '/auth/v1/user':
      return accountGone ? reply(403, { error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }) : reply(200, USER);
    case '/functions/v1/delete-account':
      return accountGone ? reply(401, { message: 'not signed in' }) : reply(500, { error: 'photo removal failed' });
    case '/rest/v1/profiles':
      return reply(200, { id: 'noa', display_name: 'Noa', reminder_time: '20:00:00', notification_prefs: {} });
    default:
      return reply(200, []);
  }
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

let client: QueryClient;
let app: ReactTestRenderer;

async function openSettings() {
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() + 3600)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } } });
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SettingsScreen />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  for (let step = 0; step < 5; step += 1) await settle();
}

/** Taps Delete account and says yes to the question before it. */
async function deleteAccount() {
  const row = app.root.findAll(
    ({ props, type }) => typeof type !== 'string' && props.accessibilityRole === 'button' && props.onPress && !props.label,
  );
  const remove = row.find((node) => node.findAllByType(AppText).some(({ props }) => props.children === 'Delete account'));
  await act(async () => remove?.props.onPress());
  const [, , buttons] = jest.mocked(Alert.alert).mock.calls[0] ?? [];
  await act(async () => (buttons as AlertButton[]).find(({ style }) => style === 'destructive')?.onPress?.());
  for (let step = 0; step < 5; step += 1) await settle();
}

/** What the app said after the question. */
const said = () => jest.mocked(Alert.alert).mock.calls.slice(1).map(([message]) => message);

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => server(new URL(String(input)))) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  accountGone = false;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
  jest.restoreAllMocks();
});

describe('a retry of a deletion whose answer was lost', () => {
  it('says nothing when the token ran out and the refresh ends the session: nobody can tell, and nothing is left to retry', async () => {
    await openSettings();
    accountGone = true;
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(sessionOf(nowSeconds() - 60)));

    await deleteAccount();

    expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(said()).toEqual([]);
  });
});

describe('a deletion that failed', () => {
  it('says so with the account still signed in', async () => {
    await openSettings();

    await deleteAccount();

    expect(await AsyncStorage.getItem(AUTH_STORAGE_KEY)).not.toBeNull();
    expect(said()).toEqual([NOT_DELETED]);
  });
});
