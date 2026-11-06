import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCalendars, type Calendar } from 'expo-localization';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import MeScreen from '@/app/(app)/me';

jest.mock('expo-localization', () => ({ ...jest.requireActual('expo-localization'), getCalendars: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } }, loading: false }) }));
jest.mock('@/features/auth/signIn', () => ({ signOut: async () => undefined }));
jest.mock('@/features/profile/AvatarButton', () => ({ AvatarButton: () => null }));
jest.mock('@/lib/push', () => ({}));
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { display_name: 'Noa' }, error: null }) }) }) }),
    rpc: async () => ({ data: { totalFeeds: 3, currentStreak: 1, bestStreak: 2, days: [] }, error: null }),
  }),
}));

let client: QueryClient;
let app: ReactTestRenderer;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
});

describe('the Me screen', () => {
  // It holds the way to Settings and Delete account, so no zone may close it.
  it.each(['Asia/Jerusalem', 'GMT+02:00', '+02:00', 'GMT+05:30', 'Etc/Unknown', 'Mars/Olympus'])('opens on a phone set to %s', async (timeZone) => {
    jest.mocked(getCalendars).mockReturnValue([{ timeZone } as Calendar]);

    await act(async () => {
      app = create(
        <QueryClientProvider client={client}>
          <MeScreen />
        </QueryClientProvider>,
      );
    });

    expect(app.root.findAll((node) => node.props.accessibilityLabel === 'Settings').length).toBeGreaterThan(0);
  });
});
