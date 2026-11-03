import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { useState } from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import * as AppLayout from '@/app/(app)/_layout';
import CreatePackScreen from '@/app/(app)/create-pack';
import JoinScreen from '@/app/(app)/join';
import InviteScreen from '@/app/(app)/pack/[id]/invite';
import NotTodayScreen from '@/app/(app)/pack/[id]/not-today';
import PackSettingsScreen from '@/app/(app)/pack/[id]/settings';
import { LoadingScreen, PackMissingScreen } from '@/components/ScreenStates';
import { packsKey, useMyPacks, usePack, type Pack, type PackPreview } from '@/features/packs/api';
import { NEW_SCREEN } from '@/lib/navigation';

// The real router, the app's own stack and the real pack screens over a stand-in for the server,
// whose answers the tests can hold back: the order they arrive in decides what a person sees.
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
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/features/days/PauseSection', () => ({ PauseSection: () => null }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/feeds/api', () => ({ useFeedQueue: () => undefined }));
jest.mock('@/features/profile/useProfile', () => ({ useAccountSync: () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ useWidgetSync: () => undefined }));
jest.mock('@/lib/notifications', () => ({ useNotificationRoutes: () => undefined }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-clipboard', () => ({ getStringAsync: async () => '', setStringAsync: async () => undefined }));
const mockNotify = jest.fn();
jest.mock('@/lib/confirm', () => ({
  confirm: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
  notify: (message: string) => mockNotify(message),
}));

let mockPacks: Pack[] = [];
let mockListAnswered: Promise<void> = Promise.resolve();
let mockPackAnswered: Promise<void> = Promise.resolve();
let mockOffline = false;
const mockNoConnection = { data: null, error: new TypeError('Network request failed') };
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          eq: (_column: string, id: string) => ({
            maybeSingle: async () => {
              await mockPackAnswered;
              return mockOffline ? mockNoConnection : { data: mockPacks.find((pack) => pack.id === id) ?? null, error: null };
            },
          }),
          order: async () => {
            await mockListAnswered;
            return mockOffline ? mockNoConnection : { data: mockPacks, error: null };
          },
        }),
      }),
    }),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  }),
}));

const MISSING = "This pack isn't here";
const CAPTION = 'caption typed over the photo';

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

/** Stands for the pack screen: the same states, by the same hook. */
function PackStandIn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending } = usePack(id);
  if (isPending) return <LoadingScreen />;
  return pack ? <Text>{`Open: ${pack.name}`}</Text> : <PackMissingScreen />;
}

/** Stands for the camera: what it holds lives and dies with the screen. */
function Camera() {
  const [caption] = useState(CAPTION);
  return <Text>{caption}</Text>;
}

const routes = {
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/_layout': AppLayout,
  '(app)/index': { default: Home },
  '(app)/create-pack': { default: CreatePackScreen },
  '(app)/join': { default: JoinScreen },
  '(app)/pack/[id]/index': { default: PackStandIn },
  '(app)/pack/[id]/feed': { default: Camera },
  '(app)/pack/[id]/invite': { default: InviteScreen },
  '(app)/pack/[id]/not-today': { default: NotTodayScreen },
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

/** Opens a screen over the one in front, as a tapped notification does. */
async function open(href: Href) {
  await act(async () => router.push(href, NEW_SCREEN));
  await settle();
}

async function goBack() {
  await act(async () => router.back());
  await settle();
}

/** The screens of the app's stack, bottom first. */
const stackRoutes = () => store.state?.routes[0]?.state?.routes[0]?.state?.routes ?? [];
const appStack = () => stackRoutes().map((route) => route.name);
const stackKeys = () => stackRoutes().map((route) => route.key);
const pathname = () => store.getRouteInfo().pathname;
const shows = (text: string) =>
  app.root.findAll((node) => typeof node.type === 'string' && node.props.children === text).length > 0;
const spinners = () => app.root.findAll((node) => node.type === 'ActivityIndicator');
const hasButton = (label: string) => app.root.findAll((node) => node.props.label === label).length > 0;
const asAdmin = (pack: Pack): Pack => ({
  ...pack,
  pack_members: pack.pack_members.map((member) => ({ ...member, role: 'admin' })),
});

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  mockPacks = [packNamed('p1')];
  mockListAnswered = Promise.resolve();
  mockPackAnswered = Promise.resolve();
  mockOffline = false;
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

  it('reaches the home screen without the pack, with the list still on its way', async () => {
    mockPacks = [packNamed('p1'), packNamed('p2')];
    await start('/pack/p1/settings');
    mockListAnswered = new Promise(() => undefined);

    await press('Leave pack');

    expect(pathname()).toBe('/');
    expect(shows('Pack p2')).toBe(true);
  });

  it("doesn't say the pack is missing to the person who is leaving it", async () => {
    await start('/pack/p1/settings');
    let answerLeave = () => {};
    mockRpc.mockImplementationOnce(async () => {
      mockPacks = [];
      await new Promise<void>((resolve) => {
        answerLeave = resolve;
      });
      return { error: null };
    });

    await press('Leave pack');
    // Word of the leave can come in over Realtime ahead of its own answer.
    await act(async () => void client.invalidateQueries({ queryKey: packsKey }));
    await settle();

    expect(pathname()).toBe('/pack/p1/settings');
    expect(shows(MISSING)).toBe(false);
    expect(spinners()).toHaveLength(1);

    await act(async () => answerLeave());
    await settle();
    expect(pathname()).toBe('/');
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

  it('is done on a second try when the server took the first and its answer was lost', async () => {
    await start('/pack/p1/settings');
    mockRpc.mockImplementationOnce(async () => {
      mockPacks = [];
      return { error: { message: 'TypeError: Network request failed' } };
    });
    mockRpc.mockResolvedValueOnce({ error: { message: 'not_a_member' } });

    await press('Leave pack');
    expect(pathname()).toBe('/pack/p1/settings');
    expect(mockNotify).toHaveBeenCalledTimes(1);

    await press('Leave pack');

    expect(pathname()).toBe('/');
    expect(shows('home')).toBe(true);
    expect(mockNotify).toHaveBeenCalledTimes(1);
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

  describe('with the settings no longer in front when the server answers', () => {
    let answerLeave = () => {};

    beforeEach(() => {
      mockPacks = [packNamed('p1'), packNamed('p2')];
      mockRpc.mockImplementationOnce(async () => {
        mockPacks = [packNamed('p2')];
        await new Promise<void>((resolve) => {
          answerLeave = resolve;
        });
        return { error: null };
      });
    });

    it('stops at a camera left under the pack, with its photo', async () => {
      await start('/pack/p2');
      await open('/pack/p2/feed');
      await open('/pack/p1');
      await open('/pack/p1/settings');
      await press('Leave pack');

      await act(async () => answerLeave());
      await settle();

      expect(pathname()).toBe('/pack/p2/feed');
      expect(shows(CAPTION)).toBe(true);
    });

    it('leaves the person where they went, with the photo on the camera', async () => {
      await start('/pack/p1');
      await open('/pack/p1/settings');
      await press('Leave pack');
      await goBack();
      await goBack();
      await open('/pack/p2');
      await open('/pack/p2/feed');

      await act(async () => answerLeave());
      await settle();

      expect(pathname()).toBe('/pack/p2/feed');
      expect(shows(CAPTION)).toBe(true);
    });

    it('goes home once they come back to the settings', async () => {
      await start('/pack/p1');
      await open('/pack/p1/settings');
      await press('Leave pack');
      await open('/pack/p1/invite');

      await act(async () => answerLeave());
      await settle();
      expect(pathname()).toBe('/pack/p1/invite');

      await goBack();

      expect(pathname()).toBe('/');
      expect(spinners()).toHaveLength(0);
    });
  });
});

describe('new settings waiting for their date', () => {
  const WAITING = 'New rest days and week start apply from Sun, Nov 8.';

  beforeEach(() => {
    mockPacks = [{ ...packNamed('p1'), pending_rest_days_per_week: 3, pending_week_start: 'monday', pending_from: '2026-11-08' }];
  });

  it('are announced while the date is ahead', async () => {
    jest.setSystemTime(new Date('2026-11-05T10:00:00Z'));
    await start('/pack/p1/settings');

    expect(shows(WAITING)).toBe(true);
  });

  it('stop being announced on that day, by the pack clock, on a screen left open', async () => {
    // 02:59 in the pack's zone, which is still the day before.
    jest.setSystemTime(new Date('2026-11-08T00:59:00Z'));
    await start('/pack/p1/settings');
    expect(shows(WAITING)).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(2 * 60_000);
    });

    expect(shows(WAITING)).toBe(false);
  });

  it('are not announced once the date has gone', async () => {
    jest.setSystemTime(new Date('2026-11-20T10:00:00Z'));
    await start('/pack/p1/settings');

    expect(shows(WAITING)).toBe(false);
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

  it('comes off the home screen on the way back, which nothing else had told of it', async () => {
    mockPacks = [packNamed('p1'), packNamed('p2')];
    await start('/');
    expect(shows('Pack p1,Pack p2')).toBe(true);
    mockPacks = [packNamed('p2')];
    await open('/pack/p1/settings');
    expect(shows(MISSING)).toBe(true);

    await press('Back to your packs');

    expect(pathname()).toBe('/');
    expect(shows('Pack p2')).toBe(true);
  });

  it('stops at a camera left underneath, with its photo', async () => {
    await start('/pack/p1');
    await open('/pack/p1/feed');
    await open('/pack/p9');
    expect(shows(MISSING)).toBe(true);

    await press('Back to your packs');

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'pack/[id]/feed']);
    expect(shows(CAPTION)).toBe(true);
  });

  it('stops at a camera further down, past what else stands over it', async () => {
    mockPacks = [packNamed('p1'), packNamed('p2')];
    await start('/pack/p1');
    await open('/pack/p1/feed');
    await open('/pack/p2');
    mockPacks = [packNamed('p1')];
    await open('/pack/p2/settings');
    expect(shows(MISSING)).toBe(true);

    await press('Back to your packs');

    expect(pathname()).toBe('/pack/p1/feed');
    expect(shows(CAPTION)).toBe(true);
  });

  it('still takes the pack off the home screen for the way back from that camera', async () => {
    mockPacks = [packNamed('p1'), packNamed('p2')];
    await start('/');
    await open('/pack/p2/feed');
    mockPacks = [packNamed('p2')];
    await open('/pack/p1/settings');
    expect(shows(MISSING)).toBe(true);

    await press('Back to your packs');
    await goBack();

    expect(pathname()).toBe('/');
    expect(shows('Pack p2')).toBe(true);
  });
});

describe('a pack the phone has only on its list', () => {
  const FAILED = "This didn't load. Check the connection and try again.";
  const LIST_TIME = 1_000_000;

  beforeEach(() => {
    client.setQueryData(packsKey, [packNamed('p1')], { updatedAt: LIST_TIME });
  });

  describe('without a connection', () => {
    beforeEach(() => {
      mockOffline = true;
    });

    it('opens its settings', async () => {
      await start('/pack/p1/settings');

      expect(shows(FAILED)).toBe(false);
      expect(shows('Pack settings')).toBe(true);
    });

    it('opens its invite', async () => {
      await start('/pack/p1/invite');

      expect(shows(FAILED)).toBe(false);
      expect(shows('ABCD2345')).toBe(true);
    });

    it('offers to try again for a pack that is not on the list', async () => {
      await start('/pack/p2/settings');

      expect(shows(FAILED)).toBe(true);
    });
  });

  it('says it is missing once the server says it is gone', async () => {
    mockPacks = [];
    await start('/pack/p1/settings');

    expect(shows(MISSING)).toBe(true);
    expect(shows('Pack settings')).toBe(false);
  });

  describe('its settings, opened on what the phone holds', () => {
    const nameField = () => app.root.findByType(TextInput);

    beforeEach(() => {
      client.setQueryData(packsKey, [asAdmin(packNamed('p1'))], { updatedAt: LIST_TIME });
      mockPacks = [{ ...asAdmin(packNamed('p1')), name: 'Renamed on another phone' }];
    });

    it.each([
      ['the list', () => undefined],
      ['a kept copy of the pack', () => client.setQueryData(['packs', 'p1'], asAdmin(packNamed('p1')), { updatedAt: LIST_TIME })],
    ])('stay as they opened from %s when the answer differs, and save nothing by themselves', async (_from, keep) => {
      keep();
      await start('/pack/p1/settings');

      expect(client.getQueryData<Pack>(['packs', 'p1'])?.name).toBe('Renamed on another phone');
      expect(nameField().props.value).toBe('Pack p1');
      expect(mockRpc).not.toHaveBeenCalledWith('update_pack', expect.anything());
    });
  });
});

describe('a rest day that takes its time', () => {
  let answerPass = () => {};
  let passToday: string | null = null;

  beforeEach(() => {
    passToday = null;
    mockRpc.mockImplementation((name: string) => {
      if (name === 'my_day_status') {
        return Promise.resolve({
          data: { day: '2026-11-02', restDaysLeft: 2, jokerAvailable: true, passToday, pause: null, pauseAvailableFrom: null },
          error: null,
        });
      }
      return new Promise((resolve) => {
        answerPass = () => {
          passToday = 'rest';
          resolve({ error: null });
        };
      });
    });
  });

  it('closes the sheet once it is answered', async () => {
    await start('/pack/p1');
    await open('/pack/p1/not-today');
    await press('Use');

    await act(async () => answerPass());
    await settle();

    expect(pathname()).toBe('/pack/p1');
  });

  describe('with another screen in front when the server answers', () => {
    it('leaves the person where they went, with the photo on the camera', async () => {
      await start('/pack/p1');
      await open('/pack/p1/not-today');
      await press('Use');
      await open('/pack/p2/feed');

      await act(async () => answerPass());
      await settle();

      expect(pathname()).toBe('/pack/p2/feed');
      expect(shows(CAPTION)).toBe(true);
    });

    it('shows the rest day on the sheet they come back to', async () => {
      await start('/pack/p1');
      await open('/pack/p1/not-today');
      await press('Use');
      await open('/pack/p2/feed');
      await act(async () => answerPass());
      await settle();

      await goBack();

      expect(pathname()).toBe('/pack/p1/not-today');
      expect(hasButton('Undo')).toBe(true);
    });
  });
});

describe('Done on the invite screen', () => {
  it('goes back to the pack, and Back from there reaches the home screen', async () => {
    await start('/pack/p1');
    await open('/pack/p1/invite');

    await press('Done');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');

    await goBack();
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

  it('stops at the pack it was opened from, with the photo on a camera under that', async () => {
    await start('/pack/p1');
    await open('/pack/p1/feed');
    await open('/pack/p1');
    await open('/pack/p1/invite');

    await press('Done');

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'pack/[id]/feed', 'pack/[id]/index']);
    await goBack();
    expect(pathname()).toBe('/pack/p1/feed');
    expect(shows(CAPTION)).toBe(true);
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

describe('with the list of packs stalled', () => {
  const stallList = () => {
    mockListAnswered = new Promise(() => undefined);
  };

  it('creating a pack goes on to its invite', async () => {
    await start('/');
    await open('/create-pack');
    stallList();
    await act(async () => app.root.findByType(TextInput).props.onChangeText('Morning runs'));
    await press('Next');
    await press('Next');
    await press('Next');

    await press('Create pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/invite']);
    expect(shows('ABCD2345')).toBe(true);
  });

  it('joining a pack goes on to it', async () => {
    mockPacks = [];
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'pack_preview') return { data: [{ ...previewOf('p1'), already_member: false }], error: null };
      mockPacks = [packNamed('p1')];
      return { data: 'p1', error: null };
    });
    await start('/');
    await open('/join?code=ABCD2345');
    stallList();

    await press('Join pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(shows('Open: Pack p1')).toBe(true);
  });

  it('saving the settings says so once the pack is back', async () => {
    mockPacks = [asAdmin(packNamed('p1'))];
    mockRpc.mockImplementation(async (name: string, args: { pack_name: string }) => {
      if (name === 'update_pack') mockPacks = [{ ...asAdmin(packNamed('p1')), name: args.pack_name }];
      return { error: null };
    });
    await start('/pack/p1/settings');
    stallList();
    await act(async () => app.root.findByType(TextInput).props.onChangeText('Morning runs'));

    await press('Save');

    expect(hasButton('Saved')).toBe(true);
  });
});

describe('a pack that takes its time to be created', () => {
  let answerCreate = () => {};

  async function fillInAndCreate() {
    await start('/');
    await open('/create-pack');
    await act(async () => app.root.findByType(TextInput).props.onChangeText('Morning runs'));
    await press('Next');
    await press('Next');
    await press('Next');
    const answer = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation(
      (name: string, args: unknown) =>
        new Promise((resolve) => {
          if (name === 'create_pack') answerCreate = () => resolve(answer(name, args));
          else resolve(answer(name, args));
        }),
    );
    await press('Create pack');
  }

  it('goes on to its invite once it is answered', async () => {
    await fillInAndCreate();

    await act(async () => answerCreate());
    await settle();

    expect(pathname()).toBe('/pack/p2/invite');
  });

  describe('with another screen in front when the server answers', () => {
    it('leaves the person where they went, with the photo on the camera', async () => {
      await fillInAndCreate();
      await open('/pack/p1/feed');

      await act(async () => answerCreate());
      await settle();

      expect(pathname()).toBe('/pack/p1/feed');
      expect(shows(CAPTION)).toBe(true);
    });

    it('lists the pack on the home screen', async () => {
      await fillInAndCreate();
      await open('/pack/p1/feed');

      await act(async () => answerCreate());
      await settle();

      expect(shows('Pack p1,Pack p2')).toBe(true);
    });

    it('goes on to its invite on the way back, with no form left to create it twice', async () => {
      await fillInAndCreate();
      await open('/pack/p1/feed');
      await act(async () => answerCreate());
      await settle();

      await goBack();

      expect(pathname()).toBe('/pack/p2/invite');
      expect(hasButton('Create pack')).toBe(false);
    });
  });
});

describe('a new invite code', () => {
  const FRESH = 'EFGH6789';

  async function getNewCode() {
    let link = app.root.find((node) => typeof node.type === 'string' && node.props.children === 'Get a new code');
    while (!link.props.onPress && link.parent) link = link.parent;
    await act(async () => link.props.onPress());
    await settle();
  }

  beforeEach(() => {
    mockPacks = [asAdmin(packNamed('p1'))];
    mockRpc.mockImplementation(async (name: string) => {
      if (name !== 'renew_invite_code') return { error: null };
      mockPacks = [{ ...asAdmin(packNamed('p1')), invite_code: FRESH }];
      return { data: FRESH, error: null };
    });
  });

  it('takes the place of the old one', async () => {
    await start('/pack/p1/invite');

    await getNewCode();

    expect(shows(FRESH)).toBe(true);
    expect(shows('ABCD2345')).toBe(false);
  });

  it('shows with the server answer, while the reads are stalled', async () => {
    await start('/pack/p1/invite');
    mockListAnswered = new Promise(() => undefined);
    mockPackAnswered = new Promise(() => undefined);

    await getNewCode();

    expect(shows(FRESH)).toBe(true);
    expect(shows('ABCD2345')).toBe(false);
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

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'pack/[id]/index']);
    expect(pathname()).toBe('/pack/p1');
  });

  it('keeps the way back through another pack', async () => {
    mockPacks = [packNamed('p1'), packNamed('p3')];
    await start('/pack/p1');
    await open('/pack/p3');
    await open('/join?code=ABCD2345');

    await press('Open pack');
    await goBack();

    expect(pathname()).toBe('/pack/p3');
  });

  it('leaves the photo on the camera underneath', async () => {
    await start('/pack/p1');
    await open('/pack/p1/feed');
    await open('/join?code=ABCD2345');

    await press('Open pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index', 'pack/[id]/feed', 'pack/[id]/index']);
    await goBack();
    expect(pathname()).toBe('/pack/p1/feed');
    expect(shows(CAPTION)).toBe(true);
  });

  it('shows the pack that stood missing underneath', async () => {
    await start('/');
    mockPacks = [];
    await open('/pack/p1');
    expect(shows(MISSING)).toBe(true);
    // Back in the pack, by a way that told this phone nothing.
    mockPacks = [packNamed('p1')];
    await open('/join?code=ABCD2345');

    await press('Open pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(shows(MISSING)).toBe(false);
    expect(shows('Open: Pack p1')).toBe(true);
  });

  it("doesn't say the pack isn't here on what the phone kept from before", async () => {
    await start('/');
    mockPacks = [];
    await open('/pack/p1');
    expect(shows(MISSING)).toBe(true);
    await goBack();
    // Back in the pack, by a way that told this phone nothing.
    mockPacks = [packNamed('p1')];
    await open('/join?code=ABCD2345');
    mockPackAnswered = new Promise(() => undefined);

    await press('Open pack');

    expect(pathname()).toBe('/pack/p1');
    expect(shows(MISSING)).toBe(false);
  });

  it('tapped twice goes back once, to the same copy of the pack', async () => {
    await start('/pack/p1');
    await open('/join?code=ABCD2345');
    const underneath = stackKeys().slice(0, -1);
    const { onPress } = app.root.findAll((node) => node.props.label === 'Open pack')[0]?.props ?? {};

    await act(async () => onPress());
    await act(async () => onPress());
    await settle();

    expect(stackKeys()).toEqual(underneath);
  });
});

describe('Join pack on the join screen', () => {
  let mockJoinAnswered: Promise<void>;

  beforeEach(() => {
    mockJoinAnswered = Promise.resolve();
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'pack_preview') return { data: [{ ...previewOf('p1'), already_member: false }], error: null };
      if (name === 'leave_pack') mockPacks = [];
      if (name !== 'join_pack') return { error: null };
      await mockJoinAnswered;
      mockPacks = [packNamed('p1')];
      return { data: 'p1', error: null };
    });
  });

  it("doesn't say the pack isn't here to someone who left it and came back", async () => {
    await start('/pack/p1/settings');
    await press('Leave pack');
    expect(client.getQueryData(['packs', 'p1'])).toBeNull();
    await open('/join?code=ABCD2345');
    let answerPack = () => {};
    mockPackAnswered = new Promise((resolve) => {
      answerPack = resolve;
    });

    await press('Join pack');

    expect(pathname()).toBe('/pack/p1');
    expect(shows(MISSING)).toBe(false);

    await act(async () => answerPack());
    await settle();
    expect(shows('Open: Pack p1')).toBe(true);
  });

  it('goes back to that pack when it stood missing underneath', async () => {
    mockPacks = [];
    await start('/pack/p1');
    await open('/join?code=ABCD2345');

    await press('Join pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(shows('Open: Pack p1')).toBe(true);
  });

  it('leaves alone a screen opened over it while the answer was on its way', async () => {
    await start('/');
    await open('/join?code=ABCD2345');
    let answerJoin = () => {};
    mockJoinAnswered = new Promise((resolve) => {
      answerJoin = resolve;
    });
    await press('Join pack');
    await open('/pack/p2/feed');

    await act(async () => answerJoin());
    await settle();

    expect(pathname()).toBe('/pack/p2/feed');
    expect(shows(CAPTION)).toBe(true);
  });
});
