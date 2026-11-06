import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityIndicator, Alert } from 'react-native';
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
const mockDelete = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => mockList() }),
      delete: () => ({ eq: () => ({ eq: (_column: string, person: string) => mockDelete(person) }) }),
    }),
  }),
}));

// The first drawing of the screen loads everything it imports.
jest.setTimeout(15_000);

const EMPTY = "You haven't blocked anyone";
const FAILED = "This didn't load";
const DAN = { blocked_id: 'dan', profiles: { display_name: 'Dan' } };
const MAYA = { blocked_id: 'maya', profiles: { display_name: 'Maya' } };

/** The text on screen, without the names of the components that draw it. */
const drawn = (node: ReactTestRendererJSON | string): string[] =>
  typeof node === 'string' ? [node] : (node.children ?? []).flatMap(drawn);

let screen: ReactTestRenderer;
let client: QueryClient;
const text = () => drawn(screen.toJSON() as ReactTestRendererJSON).join(' ');
const spinners = () => screen.root.findAllByType(ActivityIndicator);
/** The Unblock links as a finger reaches them: a disabled one does nothing. */
const unblockLinks = () =>
  screen.root.findAll(
    (node) => typeof node.type === 'string' && node.props.onClick && node.findAll((child) => child.children.includes('Unblock')).length > 0,
  );
async function tapUnblock(row = 0) {
  await act(async () => unblockLinks()[row]?.props.onClick({}));
  await settle();
}

// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

async function open() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
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

describe('Unblock', () => {
  let alert: jest.SpyInstance;
  let failDelete: () => void;
  let finishDelete: () => void;

  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockList = async () => ({ data: [DAN, MAYA], error: null });
    mockDelete.mockReset();
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          failDelete = () => resolve({ error: new TypeError('Network request failed') });
          finishDelete = () => resolve({ error: null });
        }),
    );
  });

  // TanStack keeps rescheduling the clean-up of a mutation still pending, and Jest would wait on it.
  afterEach(async () => {
    await act(async () => finishDelete());
    await settle();
    jest.restoreAllMocks();
  });

  it('sends one request and says one thing, however often a slow failure is tapped', async () => {
    await open();
    await tapUnblock();
    await tapUnblock();
    await tapUnblock();
    expect(mockDelete).toHaveBeenCalledTimes(1);

    await act(async () => failDelete());
    await settle();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Dan');
  });

  it('says it is at work on that person', async () => {
    await open();
    await tapUnblock();

    expect(spinners()).toHaveLength(1);
    expect(unblockLinks()[0]?.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(unblockLinks()[1]?.props.accessibilityState).toEqual({ disabled: true, busy: false });

    await act(async () => finishDelete());
    await settle();
    expect(spinners()).toEqual([]);
  });

  it('can be tried again after a failure', async () => {
    await open();
    await tapUnblock();
    await act(async () => failDelete());
    await settle();

    await tapUnblock(1);

    expect(mockDelete.mock.calls).toEqual([['dan'], ['maya']]);
  });
});
