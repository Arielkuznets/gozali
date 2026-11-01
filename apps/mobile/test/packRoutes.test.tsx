import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import CreatePackScreen from '@/app/(app)/create-pack';
import JoinScreen from '@/app/(app)/join';
import InviteScreen from '@/app/(app)/pack/[id]/invite';
import PackSettingsScreen from '@/app/(app)/pack/[id]/settings';
import { useMyPacks, type Pack, type PackPreview } from '@/features/packs/api';

// The real router and the real pack screens over a stand-in for the server, whose answers the
// tests can hold back: the order they arrive in decides what a person sees.
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path: string) => `gozali://${path}`,
  resolveScheme: () => 'gozali',
  addEventListener: () => ({ remove: () => undefined }),
}));
const USER = 'user-1';
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' } }, loading: false }),
}));
jest.mock('@/features/days/PauseSection', () => ({ PauseSection: () => null }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-clipboard', () => ({ getStringAsync: async () => '', setStringAsync: async () => undefined }));
const mockNotify = jest.fn();
jest.mock('@/lib/confirm', () => ({
  confirm: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
  notify: (message: string) => mockNotify(message),
}));

let mockPacks: Pack[] = [];
let mockListAnswered: Promise<void> = Promise.resolve();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => ({ data: mockPacks.find((pack) => pack.id === id) ?? null, error: null }),
        }),
        order: async () => {
          await mockListAnswered;
          return { data: mockPacks, error: null };
        },
      }),
    }),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  }),
}));

const MISSING = "This pack isn't here";

const previewOf = (packId: string): PackPreview => ({
  pack_id: packId,
  pack_name: `Pack ${packId}`,
  category: 'gym',
  custom_habit: null,
  critter: { species: 'kit', name: null, health: 100, xp: 0, stage: 'egg', status: 'egg', streak: 0, coins: 0, marks: [], outfit: null },
  member_count: 2,
  member_names: [],
  is_full: false,
  already_member: true,
});

const packNamed = (id: string): Pack => ({
  id,
  name: `Pack ${id}`,
  category: 'gym',
  custom_habit: null,
  rest_days_per_week: 1,
  week_start: 'sunday',
  invite_code: 'ABCD2345',
  pending_rest_days_per_week: null,
  pending_week_start: null,
  pending_from: null,
  timezone: 'Asia/Jerusalem',
  critters: null,
  pack_members: [
    { user_id: USER, role: 'member', status: 'active', joined_at: '2026-10-01T10:00:00Z', profiles: null },
  ],
});

function Home() {
  const packs = useMyPacks();
  return <Text>{packs.data?.map((pack) => pack.name).join() || 'home'}</Text>;
}

const routes = {
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/_layout': {
    default: () => <Stack screenOptions={{ headerShown: false }} />,
    unstable_settings: { initialRouteName: 'index' },
  },
  '(app)/index': { default: Home },
  '(app)/create-pack': { default: CreatePackScreen },
  '(app)/join': { default: JoinScreen },
  '(app)/pack/[id]/index': { default: () => <Text>pack</Text> },
  '(app)/pack/[id]/invite': { default: InviteScreen },
  '(app)/pack/[id]/settings': { default: PackSettingsScreen },
};

let client: QueryClient;
let app: ReactTestRenderer;

async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
  }
}

async function start(location: string) {
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <ExpoRoot context={getMockContext(routes as never)} location={location} />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function press(label: string) {
  await act(async () => app.root.findAll((node) => node.props.label === label)[0]?.props.onPress());
  await settle();
}

async function open(href: Href) {
  await act(async () => router.push(href));
  await settle();
}

/** The screens of the app's stack, bottom first. */
const appStack = () => store.state?.routes[0]?.state?.routes[0]?.state?.routes.map((route) => route.name) ?? [];
const pathname = () => store.getRouteInfo().pathname;
const shows = (text: string) =>
  app.root.findAll((node) => typeof node.type === 'string' && node.props.children === text).length > 0;
const spinners = () => app.root.findAll((node) => node.type === 'ActivityIndicator');

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  mockPacks = [packNamed('p1')];
  mockListAnswered = Promise.resolve();
  mockNotify.mockClear();
  mockRpc.mockReset();
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'leave_pack') mockPacks = [];
    if (name === 'pack_preview') return { data: [previewOf('p1')], error: null };
    if (name === 'create_pack') {
      mockPacks = [...mockPacks, packNamed('p2')];
      return { data: 'p2', error: null };
    }
    return { error: null };
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
  jest.useRealTimers();
});

describe('leaving a pack', () => {
  it('ends on the home screen, though the pack is gone before the leaving is done', async () => {
    await start('/pack/p1/settings');
    let answerList = () => {};
    mockListAnswered = new Promise((resolve) => {
      answerList = resolve;
    });

    await press('Leave pack');
    await act(async () => answerList());
    await settle();

    expect(pathname()).toBe('/');
    expect(shows('home')).toBe(true);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("doesn't say the pack is missing to the person who is leaving it", async () => {
    await start('/pack/p1/settings');
    let answerList = () => {};
    mockListAnswered = new Promise((resolve) => {
      answerList = resolve;
    });

    await press('Leave pack');

    expect(pathname()).toBe('/pack/p1/settings');
    expect(shows(MISSING)).toBe(false);
    expect(spinners()).toHaveLength(1);

    await act(async () => answerList());
    await settle();
    expect(shows(MISSING)).toBe(false);
  });

  it('stays on the settings and says so when the server refuses', async () => {
    await start('/pack/p1/settings');
    mockRpc.mockResolvedValue({ error: { message: 'boom' } });

    await press('Leave pack');

    expect(mockRpc).toHaveBeenCalledWith('leave_pack', { target: 'p1' });
    expect(pathname()).toBe('/pack/p1/settings');
    expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
    expect(shows(MISSING)).toBe(false);
  });

  it('leaves nothing to go back to', async () => {
    await start('/pack/p1');
    await open('/pack/p1/settings');

    await press('Leave pack');

    expect(appStack()).toEqual(['index']);
    expect(router.canGoBack()).toBe(false);
  });

  it('still says the pack is missing to someone who was removed from it', async () => {
    mockPacks = [];
    await start('/pack/p1/settings');

    expect(shows(MISSING)).toBe(true);
  });
});

describe('a pack that is gone', () => {
  it('goes back to the home screen, with nothing left to go back to', async () => {
    await start('/pack/p1');
    mockPacks = [];
    await open('/pack/p1/settings');
    expect(shows(MISSING)).toBe(true);

    await press('Back to your packs');

    expect(appStack()).toEqual(['index']);
    expect(router.canGoBack()).toBe(false);
  });
});

describe('Done on the invite screen', () => {
  it('goes back to the pack, and Back from there reaches the home screen', async () => {
    await start('/pack/p1');
    await open('/pack/p1/invite');

    await press('Done');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');

    await act(async () => router.back());
    await settle();
    expect(pathname()).toBe('/');
    expect(router.canGoBack()).toBe(false);
  });

  it('goes back past the settings it was opened from', async () => {
    await start('/pack/p1');
    await open('/pack/p1/settings');
    await press('Invite link and QR code');

    await press('Done');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');
  });

  it('opens the pack over the home screen when it has only just been created', async () => {
    await start('/');
    await open('/create-pack');
    await act(async () => app.root.findByType(TextInput).props.onChangeText('Morning runs'));
    await press('Next');
    await press('Next');
    await press('Next');
    await press('Create pack');
    expect(appStack()).toEqual(['index', 'pack/[id]/invite']);

    await press('Done');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p2');
  });
});

describe('a new code reaching the join screen that is open', () => {
  const codeField = () => app.root.findByType(TextInput);

  it('replaces the code on it', async () => {
    await start('/');
    await open('/join?code=ABCD2345');
    expect(codeField().props.value).toBe('ABCD2345');

    await act(async () => router.navigate('/join?code=EFGH6789'));
    await settle();

    expect(appStack()).toEqual(['index', 'join']);
    expect(codeField().props.value).toBe('EFGH6789');
  });
});

describe('Open pack on the join screen', () => {
  it('goes back to the pack when it is open underneath', async () => {
    await start('/pack/p1');
    await open('/join?code=ABCD2345');

    await press('Open pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');
  });

  it('opens the pack over the home screen otherwise', async () => {
    await start('/');
    await open('/join?code=ABCD2345');

    await press('Open pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');
  });

  it('shows that pack when another pack is open underneath', async () => {
    mockPacks = [packNamed('p1'), packNamed('p3')];
    await start('/pack/p3');
    await open('/join?code=ABCD2345');

    await press('Open pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');
  });
});
