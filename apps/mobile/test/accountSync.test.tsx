import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCalendars, type Calendar } from 'expo-localization';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAccountSync } from '@/features/profile/useProfile';

jest.mock('expo-localization', () => ({ ...jest.requireActual('expo-localization'), getCalendars: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } }, loading: false }) }));
jest.mock('@/features/auth/signIn', () => ({ forgetOtherAccounts: async () => undefined }));
jest.mock('@/lib/notifications', () => ({ askForNotificationsOnce: async () => undefined }));
jest.mock('@/lib/push', () => ({ registerPushToken: async () => undefined }));
jest.mock('@/lib/reportError', () => ({ sendPendingCrash: async () => undefined }));

/** The profile on the server, whose trigger saves a zone it doesn't know as UTC. */
let mockZone: string;
const mockKnownZones = ['UTC', 'Etc/GMT-2', 'Asia/Jerusalem', 'America/New_York', 'America/Los_Angeles'];
/** Whether the phone can reach the server. */
let mockOnline: boolean;
const mockNoConnection = { message: 'TypeError: Network request failed' };
const mockZonesSent: unknown[] = [];
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => (mockOnline ? { data: { id: 'noa', timezone: mockZone }, error: null } : { data: null, error: mockNoConnection }),
        }),
      }),
      update: ({ timezone }: { timezone: string }) => ({
        eq: async () => {
          mockZonesSent.push(timezone);
          if (!mockOnline) return { error: mockNoConnection };
          mockZone = mockKnownZones.includes(timezone) ? timezone : 'UTC';
          return { error: null };
        },
      }),
    }),
  }),
}));

type Connection = { isConnected: boolean; isInternetReachable: boolean };
const mockNetwork = new Set<(state: Connection) => void>();
// Like NetInfo, a new listener hears the state there is now.
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (listener: (state: Connection) => void) => {
    mockNetwork.add(listener);
    listener({ isConnected: mockOnline, isInternetReachable: mockOnline });
    return () => mockNetwork.delete(listener);
  },
}));

function AccountSync() {
  useAccountSync();
  return null;
}

let client: QueryClient;
let app: ReactTestRenderer;

/** Long enough for the profile to load and for what it starts to finish. */
async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function startApp() {
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <AccountSync />
      </QueryClientProvider>,
    );
  });
  await settle();
}

const appStates = new Set<(state: AppStateStatus) => void>();

async function comeBackToApp() {
  for (const state of ['background', 'active'] as const) {
    await act(async () => appStates.forEach((listener) => listener(state)));
  }
  await settle();
}

async function connectionComesBack() {
  mockOnline = true;
  await act(async () => mockNetwork.forEach((listener) => listener({ isConnected: true, isInternetReachable: true })));
  await settle();
}

const phoneSetTo = (timeZone: string) => jest.mocked(getCalendars).mockReturnValue([{ timeZone } as Calendar]);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockZonesSent.length = 0;
  mockZone = 'UTC';
  mockOnline = true;
  appStates.clear();
  mockNetwork.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStates.add(listener);
    return { remove: () => appStates.delete(listener) };
  });
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
});

describe('the time zone', () => {
  it('reaches the server under the name of its offset, and stays there', async () => {
    phoneSetTo('GMT+02:00');
    await startApp();
    expect(mockZonesSent).toEqual(['Etc/GMT-2']);
    expect(mockZone).toBe('Etc/GMT-2');
  });

  it('is sent once when the server saves it as UTC, not over and over', async () => {
    phoneSetTo('America/Coyhaique');
    await startApp();
    expect(mockZonesSent).toEqual(['America/Coyhaique']);
    expect(mockZone).toBe('UTC');

    await act(async () => {
      await client.invalidateQueries();
    });
    expect(mockZonesSent).toEqual(['America/Coyhaique']);
  });

  it('is not sent when the profile already holds it', async () => {
    phoneSetTo('GMT+05:30');
    await startApp();
    expect(mockZonesSent).toEqual([]);
  });

  it('is sent when the app comes back in another zone', async () => {
    mockZone = 'Asia/Jerusalem';
    phoneSetTo('Asia/Jerusalem');
    await startApp();
    phoneSetTo('America/New_York');

    await comeBackToApp();

    expect(mockZonesSent).toEqual(['America/New_York']);
    expect(mockZone).toBe('America/New_York');
  });

  it("that couldn't be saved without a connection is sent again once there is one", async () => {
    // A start with no connection, from the profile the phone kept.
    mockOnline = false;
    mockZone = 'Asia/Jerusalem';
    client.setQueryData(['profile', 'noa'], { id: 'noa', timezone: 'Asia/Jerusalem' });
    phoneSetTo('America/Los_Angeles');
    await startApp();
    expect(mockZonesSent).toEqual(['America/Los_Angeles']);

    await connectionComesBack();

    expect(mockZonesSent).toEqual(['America/Los_Angeles', 'America/Los_Angeles']);
    expect(mockZone).toBe('America/Los_Angeles');
  });
});
