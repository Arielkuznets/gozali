import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCalendars, type Calendar } from 'expo-localization';
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
const mockZonesSent: unknown[] = [];
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'noa', timezone: mockZone }, error: null }) }) }),
      update: ({ timezone }: { timezone: string }) => ({
        eq: async () => {
          mockZonesSent.push(timezone);
          mockZone = ['UTC', 'Etc/GMT-2'].includes(timezone) ? timezone : 'UTC';
          return { error: null };
        },
      }),
    }),
  }),
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

const phoneSetTo = (timeZone: string) => jest.mocked(getCalendars).mockReturnValue([{ timeZone } as Calendar]);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  mockZonesSent.length = 0;
  mockZone = 'UTC';
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
});
