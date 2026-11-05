import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { useState } from 'react';
import { BackHandler, Platform, Text, TextInput, type HardwareBackPressEvent } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import * as AppLayout from '@/app/(app)/_layout';
import CreatePackScreen from '@/app/(app)/create-pack';
import JoinScreen from '@/app/(app)/join';
import InviteScreen from '@/app/(app)/pack/[id]/invite';
import NotTodayScreen from '@/app/(app)/pack/[id]/not-today';
import PackSettingsScreen from '@/app/(app)/pack/[id]/settings';
import { LoadingScreen, PackMissingScreen } from '@/components/ScreenStates';
import { usePackFeed } from '@/features/feeds/api';
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
jest.mock('@/features/feeds/api', () => ({ ...jest.requireActual('@/features/feeds/api'), useFeedQueue: () => undefined }));
jest.mock('@/features/feeds/queue', () => ({}));
jest.mock('@/features/feeds/send', () => ({
  PHOTO_BUCKET: 'photos',
  isNetworkFailure: (error: unknown) => jest.requireActual<typeof import('@/features/feeds/send')>('@/features/feeds/send').isNetworkFailure(error),
}));
jest.mock('@react-native-community/netinfo', () => ({}));
jest.mock('@/features/profile/useProfile', () => ({ useAccountSync: () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ useWidgetSync: () => undefined }));
jest.mock('@/lib/notifications', () => ({ useNotificationRoutes: () => undefined }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
const mockClipboard = jest.fn();
jest.mock('expo-clipboard', () => ({ getStringAsync: () => mockClipboard(), setStringAsync: async () => undefined }));
const mockNotify = jest.fn();
jest.mock('@/lib/confirm', () => ({
  confirm: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
  notify: (message: string) => mockNotify(message),
}));

let mockPacks: Pack[] = [];
let mockListAnswered: Promise<void> = Promise.resolve();
let mockPackAnswered: Promise<void> = Promise.resolve();
let mockOffline = false;
let mockPhotos: { id: string }[] = [];
/** When the stand-in server made a pack; one not here was made long ago. */
const mockMadeAt = new Map<string, string>();
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
        eq: (_column: string, value: string) => ({
          // As row level security has it: the photos are there for someone in the pack.
          order: () => ({ limit: async () => ({ data: mockPacks.some((pack) => pack.id === value) ? mockPhotos : [], error: null }) }),
          // The pack by its id, read for a part of it.
          maybeSingle: async () => {
            await mockPackAnswered;
            return mockOffline ? mockNoConnection : { data: mockPacks.find((pack) => pack.id === value) ?? null, error: null };
          },
          // The packs of this name made since then, newest first.
          gte: (_made: string, since: string) => ({
            order: async () => ({
              data: mockPacks.filter((pack) => pack.name === value && (mockMadeAt.get(pack.id) ?? '') >= since).reverse(),
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc: (name: string, args: unknown) => (name === 'feed_reactions' ? { data: [], error: null } : mockRpc(name, args)),
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

/** Stands for the pack screen: the same states and the same photos, by the same hooks. */
function PackStandIn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: pack, isPending } = usePack(id);
  const { data: photos } = usePackFeed(id);
  if (isPending) return <LoadingScreen />;
  if (!pack) return <PackMissingScreen />;
  return (
    <>
      <Text>{`Open: ${pack.name}`}</Text>
      <Text>{`Photos: ${photos?.length ?? 0}`}</Text>
    </>
  );
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
  mockPhotos = [];
  mockMadeAt.clear();
  mockNotify.mockClear();
  mockClipboard.mockReset().mockResolvedValue('');
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

  describe('when the server took it, its answer was lost and word of it came over Realtime', () => {
    const LOST = { error: { message: 'TypeError: Network request failed' } };

    it('goes home with the word, though the form had stayed for a second try', async () => {
      await start('/pack/p1/settings');
      mockRpc.mockImplementationOnce(async () => {
        mockPacks = [];
        return LOST;
      });
      await press('Leave pack');
      expect(mockNotify).toHaveBeenCalledTimes(1);
      expect(hasButton('Leave pack')).toBe(true);

      await act(async () => void client.invalidateQueries({ queryKey: packsKey }));
      await settle();

      expect(pathname()).toBe('/');
      expect(shows('home')).toBe(true);
      expect(shows(MISSING)).toBe(false);
    });

    it('goes home from the spinner, which has a Back while it waits for the answer', async () => {
      await start('/pack/p1/settings');
      let loseAnswer = () => {};
      mockRpc.mockImplementationOnce(async () => {
        mockPacks = [];
        await new Promise<void>((resolve) => {
          loseAnswer = resolve;
        });
        return LOST;
      });
      await press('Leave pack');
      await act(async () => void client.invalidateQueries({ queryKey: packsKey }));
      await settle();
      expect(spinners()).toHaveLength(1);
      expect(hasButton('Back')).toBe(true);

      await act(async () => loseAnswer());
      await settle();

      expect(pathname()).toBe('/');
      expect(shows(MISSING)).toBe(false);
    });
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

describe('a pack whose answer was lost', () => {
  const NAME = 'Morning runs';
  const noAnswer = { data: null, error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' } };
  const creates = () => mockRpc.mock.calls.filter(([name]) => name === 'create_pack').length;
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  /**
   * A pack as the form makes it when only the name is typed: the gym, its 3 rest days and the first
   * egg. A pack an earlier test was answered with stays known for the rest of the file, as for the
   * rest of an app's run, so each pack made here has an id of its own.
   */
  const likeTheForm = (id: string): Pack => ({
    ...asAdmin(packNamed(id)),
    name: NAME,
    rest_days_per_week: 3,
    critters: { species: 'mochi', name: null, health: 100, xp: 0, stage: 'egg', status: 'egg', streak: 0, coins: 0, marks: [], outfit: null },
  });

  async function fillInAndCreate(ownHabit?: string) {
    await open('/create-pack');
    await act(async () => app.root.findByType(TextInput).props.onChangeText(NAME));
    await press('Next');
    if (ownHabit) {
      await press('Custom');
      await act(async () => app.root.findByType(TextInput).props.onChangeText(ownHabit));
    }
    await press('Next');
    await press('Next');
    await press('Create pack');
  }

  beforeEach(() => {
    mockRpc.mockImplementation(async (name: string) => (name === 'create_pack' ? noAnswer : { error: null }));
  });

  it('goes on to the invite of the pack the server made, once', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name !== 'create_pack') return { error: null };
      mockPacks = [...mockPacks, likeTheForm('lost-1')];
      mockMadeAt.set('lost-1', minutesAgo(0));
      return noAnswer;
    });
    await start('/');

    await fillInAndCreate();

    expect(pathname()).toBe('/pack/lost-1/invite');
    expect(creates()).toBe(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('goes on to the invite of the pack the server made with a habit of its own', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name !== 'create_pack') return { error: null };
      mockPacks = [...mockPacks, { ...likeTheForm('lost-2'), category: 'custom', custom_habit: 'Stretching', rest_days_per_week: 1 }];
      mockMadeAt.set('lost-2', minutesAgo(0));
      return noAnswer;
    });
    await start('/');

    await fillInAndCreate('Stretching');

    expect(pathname()).toBe('/pack/lost-2/invite');
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('says saving failed when the server made none, beside a pack of the same name made just before', async () => {
    mockPacks = [likeTheForm('p1')];
    mockMadeAt.set('p1', minutesAgo(1));
    await start('/');

    await fillInAndCreate();

    expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
    expect(pathname()).toBe('/create-pack');
  });

  it('says saving failed when the server made none, beside one of the same name the list here lacks', async () => {
    await start('/');
    mockPacks = [...mockPacks, likeTheForm('p3')];
    mockMadeAt.set('p3', minutesAgo(10));

    await fillInAndCreate();

    expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
    expect(pathname()).toBe('/create-pack');
  });

  it('says saving failed when the server made none, beside one of the same name a create here was answered with', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name !== 'create_pack') return { error: null };
      if (creates() > 1) return noAnswer;
      mockPacks = [...mockPacks, likeTheForm('answered-1')];
      mockMadeAt.set('answered-1', minutesAgo(0));
      return { data: 'answered-1', error: null };
    });
    await start('/');
    mockListAnswered = new Promise(() => undefined);
    await fillInAndCreate();
    expect(pathname()).toBe('/pack/answered-1/invite');

    await fillInAndCreate();

    expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
    expect(pathname()).toBe('/create-pack');
  });

  it.each<[string, Partial<Pack>]>([
    ['another egg', { critters: { ...likeTheForm('p3').critters!, species: 'kit' } }],
    ['another habit', { category: 'running' }],
    ['other rest days', { rest_days_per_week: 2 }],
  ])('says saving failed when the server made none, beside one of the same name made just before with %s', async (_other, other) => {
    await start('/');
    mockPacks = [...mockPacks, { ...likeTheForm('p3'), ...other }];
    mockMadeAt.set('p3', minutesAgo(1));

    await fillInAndCreate();

    expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
    expect(pathname()).toBe('/create-pack');
  });

  it('says saving failed when the server made none, beside one of the same name made just before with another habit of its own', async () => {
    await start('/');
    mockPacks = [...mockPacks, { ...likeTheForm('p3'), category: 'custom', custom_habit: 'Yoga at noon', rest_days_per_week: 1 }];
    mockMadeAt.set('p3', minutesAgo(1));

    await fillInAndCreate('Stretching');

    expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
    expect(pathname()).toBe('/create-pack');
  });
});

describe("the phone's own way back on Create pack", () => {
  const onStep = (step: number) => shows(`Step ${step} of 4`);

  describe('on Android', () => {
    /** What the back button reaches: the newest listener first, until one takes it. */
    const listeners: ((event: HardwareBackPressEvent) => boolean | null | undefined)[] = [];
    const pressBack = async () => {
      await act(async () => {
        const event = { type: 'hardwareBackPress', timeStamp: Date.now() };
        [...listeners].reverse().some((listener) => listener(event));
      });
      await settle();
    };
    let platform: jest.ReplaceProperty<typeof Platform.OS>;

    beforeEach(() => {
      platform = jest.replaceProperty(Platform, 'OS', 'android');
      listeners.length = 0;
      jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_name, listener) => {
        listeners.push(listener);
        return { remove: () => void listeners.splice(listeners.indexOf(listener), 1) };
      });
    });

    afterEach(() => {
      jest.mocked(BackHandler.addEventListener).mockRestore();
      platform.restore();
    });

    it('goes back a step, with what was typed kept', async () => {
      await start('/');
      await open('/create-pack');
      await act(async () => app.root.findByType(TextInput).props.onChangeText('Morning runs'));
      await press('Next');
      await press('Next');
      expect(onStep(3)).toBe(true);

      await pressBack();
      expect(onStep(2)).toBe(true);
      await pressBack();

      expect(appStack()).toEqual(['index', 'create-pack']);
      expect(onStep(1)).toBe(true);
      expect(app.root.findByType(TextInput).props.value).toBe('Morning runs');
    });

    it('leaves the form from its first step', async () => {
      await start('/');
      await open('/create-pack');

      await pressBack();

      expect(appStack()).toEqual(['index']);
    });
  });

  it('takes no swipe away on iOS past the first step', async () => {
    /** Whether the swipe from the edge may take the screen away. */
    const swipeBack = () => (store.navigationRef.getCurrentOptions() as { gestureEnabled?: boolean } | undefined)?.gestureEnabled !== false;
    await start('/');
    await open('/create-pack');
    expect(swipeBack()).toBe(true);

    await act(async () => app.root.findByType(TextInput).props.onChangeText('Morning runs'));
    await press('Next');
    expect(swipeBack()).toBe(false);

    await press('Back');
    expect(onStep(1)).toBe(true);
    expect(swipeBack()).toBe(true);
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

  it("shows the server's code when the answer was lost after the code changed", async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name !== 'renew_invite_code') return { error: null };
      mockPacks = [{ ...asAdmin(packNamed('p1')), invite_code: FRESH }];
      return { data: null, error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' } };
    });
    await start('/pack/p1/invite');

    await getNewCode();

    expect(shows(FRESH)).toBe(true);
    expect(shows('ABCD2345')).toBe(false);
  });

  describe('with the answer lost', () => {
    const lost = { data: null, error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' } };

    it('counts as done once the server has another code, and the copied one is no longer Copied!', async () => {
      mockRpc.mockImplementation(async (name: string) => {
        if (name !== 'renew_invite_code') return { error: null };
        mockPacks = [{ ...asAdmin(packNamed('p1')), invite_code: FRESH }];
        return lost;
      });
      await start('/pack/p1/invite');
      await press('Copy code');
      expect(hasButton('Copied!')).toBe(true);

      await getNewCode();

      expect(shows(FRESH)).toBe(true);
      expect(hasButton('Copy code')).toBe(true);
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('says saving failed when the server still has the code from before', async () => {
      mockRpc.mockImplementation(async (name: string) => (name === 'renew_invite_code' ? lost : { error: null }));
      await start('/pack/p1/invite');
      await press('Copy code');

      await getNewCode();

      expect(mockNotify).toHaveBeenCalledWith("Saving didn't work. Please try again.");
      expect(shows('ABCD2345')).toBe(true);
      expect(hasButton('Copied!')).toBe(true);
    });
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

describe('a join link with the code in it twice', () => {
  it('opens the join screen with the first code', async () => {
    await start('/');

    await open('/join?code=ABCD2345&code=EFGH6789');

    expect(appStack()).toEqual(['index', 'join']);
    expect(app.root.findByType(TextInput).props.value).toBe('ABCD2345');
  });
});

describe('the code field on the join screen', () => {
  // A code is Latin letters and digits, which a Hebrew layout's letter keys don't type.
  it.each([
    ['ios', 'ascii-capable'],
    ['android', 'visible-password'],
  ] as const)('asks %s for a keyboard with Latin letters', async (os, keyboard) => {
    const platform = jest.replaceProperty(Platform, 'OS', os);
    try {
      await start('/');
      await open('/join');

      expect(app.root.findByType(TextInput).props.keyboardType).toBe(keyboard);
    } finally {
      platform.restore();
    }
  });
});

describe('Paste on the join screen', () => {
  const NOTHING = 'Nothing to paste. Copy the code, or type it here.';
  const codeField = () => app.root.findByType(TextInput);

  beforeEach(async () => {
    await start('/');
    await open('/join');
    await act(async () => codeField().props.onChangeText('ABCD2345'));
    await settle();
  });

  // iOS answers an empty clipboard, and a paste the person refused, with an empty string; the web
  // throws on a refusal.
  it.each([
    ['is empty', () => mockClipboard.mockResolvedValue('')],
    ['is refused', () => mockClipboard.mockRejectedValue(new Error('NoPermissionException'))],
  ])('keeps the typed code when the paste %s, and says so', async (_what, answer) => {
    answer();
    await press('Paste');

    expect(codeField().props.value).toBe('ABCD2345');
    expect(mockNotify.mock.calls).toEqual([[NOTHING]]);
  });

  it('takes the code out of a pasted invite', async () => {
    mockClipboard.mockResolvedValue('Join my pack "Gym squad" on Gozali! Code: EFGH6789\nhttps://gozali.app/i/EFGH6789');
    await press('Paste');

    expect(codeField().props.value).toBe('EFGH6789');
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('a code the server turns down for this member', () => {
  beforeEach(() => {
    // The app's own retries, which a refusal that can't change must not wait for.
    client = new QueryClient();
  });

  it.each([
    ['removed_from_pack', "The pack admin removed you from this pack, so this code can't bring you back."],
    ['too_many_attempts', "Too many codes that didn't match. Try again in an hour."],
  ])('says why at once for %s, and asks no more', async (refusal, text) => {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'pack_preview' ? { data: null, error: { code: 'P0001', message: refusal } } : { error: null },
    );
    await start('/');
    await open('/join?code=ABCD2345');

    expect(shows(text)).toBe(true);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockRpc.mock.calls.filter(([name]) => name === 'pack_preview')).toHaveLength(1);
    expect(shows(text)).toBe(true);
  });

  it('still tries again when the preview did not get through', async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'pack_preview' ? { data: null, error: { message: 'TypeError: Network request failed' } } : { error: null },
    );
    await start('/');
    await open('/join?code=ABCD2345');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    await settle();

    expect(mockRpc.mock.calls.filter(([name]) => name === 'pack_preview')).toHaveLength(4);
    expect(shows("This didn't load. Check the connection and try again.")).toBe(true);
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
    mockPhotos = [{ id: 'f1' }];
    await open('/join?code=ABCD2345');

    await press('Open pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(shows(MISSING)).toBe(false);
    expect(shows('Open: Pack p1')).toBe(true);
    expect(shows('Photos: 1')).toBe(true);
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
    mockPhotos = [{ id: 'f1' }];
    await start('/pack/p1');
    expect(shows(MISSING)).toBe(true);
    await open('/join?code=ABCD2345');

    await press('Join pack');

    expect(appStack()).toEqual(['index', 'pack/[id]/index']);
    expect(shows('Open: Pack p1')).toBe(true);
    expect(shows('Photos: 1')).toBe(true);
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
