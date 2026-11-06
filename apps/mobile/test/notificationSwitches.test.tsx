import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Switch } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// The real settings screen, auth-js and the app's own client, against a stand-in for the server
// that keeps the profile row: a PATCH replaces the columns it names, as PostgREST does.
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

const USER = { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' };
const SESSION = {
  access_token: 'noa-access',
  refresh_token: 'noa-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: USER,
};

/** The notification choices saved in the profile row. */
let savedPrefs: Record<string, boolean>;
/** Whether the profile can be read; a write goes through either way. */
let readsWork: boolean;
const writes: unknown[] = [];
jest.setTimeout(15_000);

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', date: new Date().toUTCString() } });
}

function server(url: URL, init?: RequestInit) {
  if (url.pathname !== '/rest/v1/profiles') return reply(200, []);
  if (init?.method === 'PATCH') {
    const change = JSON.parse(String(init.body)) as { notification_prefs?: Record<string, boolean> };
    writes.push(change);
    if (change.notification_prefs) savedPrefs = change.notification_prefs;
    return new Response(null, { status: 204 });
  }
  if (!readsWork) return reply(503, { message: 'unavailable' });
  return reply(200, { id: 'noa', display_name: 'Noa', reminder_time: '20:00:00', notification_prefs: savedPrefs });
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

let client: QueryClient;
let app: ReactTestRenderer;

async function openSettings() {
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(SESSION));
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

const switchFor = (label: string) => app.root.findAll((node) => node.type === Switch && node.props.accessibilityLabel === label)[0]!;

async function turn(label: string, on: boolean) {
  await act(async () => switchFor(label).props.onValueChange(on));
  for (let step = 0; step < 5; step += 1) await settle();
}

beforeAll(() => {
  globalThis.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => server(new URL(String(input)), init)) as unknown as typeof fetch;
});

afterAll(async () => {
  await requireSupabase().auth.stopAutoRefresh();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  savedPrefs = {};
  readsWork = true;
  writes.length = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
  jest.restoreAllMocks();
});

describe('a notification switch', () => {
  it('leaves the choices another phone saved since this screen read them', async () => {
    await openSettings();
    savedPrefs = { nudge: false };

    await turn('Weekly recap', false);

    expect(savedPrefs).toEqual({ nudge: false, weekly_recap: false });
    expect(switchFor('Nudges').props.value).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("isn't saved when the saved choices can't be read, and says so", async () => {
    await openSettings();
    readsWork = false;

    await turn('Nudges', false);

    expect(writes).toEqual([]);
    expect(jest.mocked(Alert.alert).mock.calls.map(([message]) => message)).toEqual(["Saving didn't work. Please try again."]);
    expect(switchFor('Nudges').props.value).toBe(true);
  });
});
