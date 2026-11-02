import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator } from 'react-native';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import '@/i18n';
import SettingsScreen from '@/app/(app)/settings';

jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/app/appConfig', () => ({ useAppConfig: () => ({ data: { apple_revocation: false } }) }));
jest.mock('@/features/auth/signIn', () => ({ deleteAccount: jest.fn(), isCancellation: () => false }));
jest.mock('@/features/profile/useProfile', () => ({
  NOTIFICATION_TYPES: ['nudge'],
  NAME_MAX_LENGTH: 30,
  useProfile: () => ({ data: { display_name: 'Noa', notification_prefs: {}, reminder_time: '20:00:00' } }),
  useUpdateProfile: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false, isSuccess: false }),
}));
jest.mock('@/lib/notifications', () => ({ useNotificationPermission: () => ({ permission: 'granted', request: jest.fn() }) }));

let mockList: () => Promise<unknown>;
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => mockList() }) }),
  }),
}));

// The first drawing of the screen loads everything it imports.
jest.setTimeout(15_000);

const EMPTY = "You haven't blocked anyone";
const FAILED = "This didn't load";

/** The text on screen, without the names of the components that draw it. */
const drawn = (node: ReactTestRendererJSON | string): string[] =>
  typeof node === 'string' ? [node] : (node.children ?? []).flatMap(drawn);

let screen: ReactTestRenderer;
let client: QueryClient;
const text = () => drawn(screen.toJSON() as ReactTestRendererJSON).join(' ');
const spinners = () => screen.root.findAllByType(ActivityIndicator);

// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

async function open() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    screen = create(
      <QueryClientProvider client={client}>
        <SettingsScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
}

afterEach(async () => {
  await act(async () => screen.unmount());
  client.clear();
});

describe('the list of blocked people', () => {
  it('shows a spinner until there is an answer, and neither answer yet', async () => {
    mockList = () => new Promise(() => undefined);
    await open();

    expect(spinners()).toHaveLength(1);
    expect(text()).not.toContain(EMPTY);
    expect(text()).not.toContain(FAILED);
  });

  it('gives the spinner up for an empty list', async () => {
    mockList = async () => ({ data: [], error: null });
    await open();

    expect(spinners()).toEqual([]);
    expect(text()).toContain(EMPTY);
  });

  it('gives the spinner up for a list that failed', async () => {
    mockList = async () => ({ data: null, error: new TypeError('Network request failed') });
    await open();

    expect(spinners()).toEqual([]);
    expect(text()).toContain(FAILED);
  });
});
