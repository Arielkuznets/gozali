import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import PackScreen from '@/app/(app)/pack/[id]/index';

// The real pack screen, feed list, hooks and QueryClient over a stand-in for the server that takes
// its time, because what counts here is what stays on screen while it does.
const mockScreen = { id: 'a', olderFails: false };
const mockLists: { photos: number; events: number; first: string }[] = [];
const mockMounts = { unmounts: 0 };
const mockReacted = new Map<string, string>();
const mockDelay = 100;

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useLocalSearchParams: () => ({ id: mockScreen.id }),
  router: { push: () => undefined },
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/components/ActionMenu', () => ({ ActionMenu: () => null }));
jest.mock('@/components/Button', () => ({ Button: () => null }));
jest.mock('@/components/Coins', () => ({ Coins: () => null }));
jest.mock('@/components/HealthBar', () => ({ HealthBar: () => null }));
jest.mock('@/components/HeaderButton', () => ({ HeaderButton: () => null }));
jest.mock('@/components/MemberCircles', () => ({ MemberCircles: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/components/ScreenStates', () => ({ LoadFailed: () => null, LoadingScreen: () => null, LoadFailedScreen: () => null, PackMissingScreen: () => null }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/profile/avatar', () => ({ useAvatarUrls: () => ({ data: new Map() }) }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/critter/HatchSteps', () => ({ HatchSteps: () => null }));
jest.mock('@/features/critter/hatch', () => ({ hatchesAtClose: () => false, hatchesTonight: () => false }));
jest.mock('@/features/critter/MilestoneMoment', () => ({ MilestoneMoment: () => null }));
jest.mock('@/features/critter/milestones', () => ({ useMilestone: () => ({ milestone: null, dismiss: () => undefined }) }));
jest.mock('@/features/critter/useCritterText', () => ({ useCritterText: () => ({ name: 'Kit', label: 'Kit', lines: [] }) }));
jest.mock('@/features/feeds/PhotoViewer', () => ({ PhotoViewer: () => null }));
jest.mock('@/features/packs/realtime', () => ({ usePackRealtime: () => undefined }));
jest.mock('@/features/social/NameMeCard', () => ({ NameMeCard: () => null }));
jest.mock('@/lib/confirm', () => ({ confirm: () => undefined, notify: () => undefined }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: () => undefined, success: () => undefined } }));
jest.mock('@/lib/navigation', () => ({ goBack: () => undefined }));
jest.mock('@/lib/useNow', () => ({ useNow: () => new Date('2026-10-31T12:00:00Z') }));
jest.mock('@/lib/serverClock', () => ({ serverNow: () => new Date('2026-10-31T12:00:00Z') }));
jest.mock('@/lib/reportError', () => ({ reportError: () => undefined, errorCode: () => undefined }));
jest.mock('@react-native-community/netinfo', () => ({}));
jest.mock('@/features/feeds/queue', () => ({ pendingFeeds: async () => [] }));
jest.mock('@/features/feeds/send', () => ({ PHOTO_BUCKET: 'photos' }));
jest.mock('@/features/days/api', () => ({
  daysKey: ['days'],
  keptToday: () => ({ passes: new Map(), paused: new Set(), pausedForSure: new Set() }),
  pauseToday: () => null,
  useDayStatus: () => ({ data: undefined }),
  useMembersToday: () => ({ data: undefined }),
  useTodayPasses: () => ({ data: undefined }),
}));

const mockPack = {
  id: 'a',
  name: 'Pack',
  category: 'reading',
  custom_habit: null,
  timezone: 'UTC',
  rest_days_per_week: 1,
  pack_members: [
    { user_id: 'me', role: 'admin', status: 'active', joined_at: '2026-01-01T00:00:00Z', profiles: { display_name: 'Me', avatar_path: null } },
    { user_id: 'dan', role: 'member', status: 'active', joined_at: '2026-01-01T00:00:00Z', profiles: { display_name: 'Dan', avatar_path: null } },
  ],
  critters: { species: 'kit', name: 'Kit', health: 80, xp: 500, stage: 'adult', status: 'active', streak: 3, coins: 100, marks: [], outfit: {} },
};
jest.mock('@/features/packs/api', () => ({
  packsKey: ['packs'],
  countedToday: (pack: typeof mockPack) => pack.pack_members,
  currentMembers: (pack: typeof mockPack) => pack.pack_members,
  restDaysOn: () => 1,
  usePack: () => ({ data: mockPack, dataUpdatedAt: 1, isPending: false, isError: false, refetch: async () => undefined }),
}));
jest.mock('@/features/feeds/FeedList', () => {
  const actual = jest.requireActual('@/features/feeds/FeedList');
  const { useEffect } = jest.requireActual('react');
  return {
    FeedList: (props: { feeds: { id: string }[]; events: unknown[] }) => {
      mockLists.push({ photos: props.feeds.length, events: props.events.length, first: props.feeds[0]?.id ?? '' });
      useEffect(
        () => () => {
          mockMounts.unmounts += 1;
        },
        [],
      );
      return <actual.FeedList {...props} />;
    },
  };
});

// 95 photos, one every six hours, and 50 events, one every five days, so most events are older than
// the 30th photo, as in a real pack.
const mockHour = 3_600_000;
const mockAt = (hoursAgo: number) => new Date(Date.parse('2026-10-31T10:00:00Z') - hoursAgo * mockHour).toISOString();
const mockAnswer = (data: unknown) => new Promise((resolve) => setTimeout(() => resolve({ data, error: null }), mockDelay));

function mockRead(table: string) {
  let pack = '';
  let limit = Infinity;
  const read: Record<string, unknown> = {
    select: () => read,
    order: () => read,
    eq: (column: string, value: string) => {
      if (column === 'pack_id') pack = value;
      return read;
    },
    limit: (count: number) => {
      limit = count;
      return read;
    },
    then: (done: (answer: unknown) => unknown, failed: (error: unknown) => unknown) => {
      if (mockScreen.olderFails && limit > 30) return Promise.resolve({ data: null, error: new Error('offline') }).then(done, failed);
      const rows =
        table === 'feeds'
          ? Array.from({ length: 95 }, (_, index) => ({
              id: `${pack}${index}`,
              pack_id: pack,
              user_id: 'dan',
              photo_path: `${pack}/${index}.jpg`,
              caption: null,
              day: '2026-10-30',
              is_extra: false,
              focus_minutes: null,
              created_at: mockAt(index * 6),
            }))
          : table === 'pack_events'
            ? Array.from({ length: 50 }, (_, index) => ({ id: `e${index}`, kind: 'joined', actor_id: 'dan', payload: {}, created_at: mockAt(1 + index * 120) }))
            : [];
      return mockAnswer(rows.slice(0, limit)).then(done, failed);
    },
  };
  return read;
}

function mockRpc(name: string, args: { feed_ids?: string[]; target_feed?: string; emoji?: string }) {
  if (name === 'react') mockReacted.set(args.target_feed ?? '', args.emoji ?? '');
  const totals = (args.feed_ids ?? []).flatMap((id) => {
    const emoji = mockReacted.get(id);
    return emoji ? [{ feed_id: id, emoji, total: 1, mine: true, names: ['Me'] }] : [];
  });
  return mockAnswer(name === 'react' ? null : totals);
}

jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: mockRead,
    rpc: mockRpc,
    storage: {
      from: () => ({ createSignedUrls: (paths: string[]) => mockAnswer(paths.map((path) => ({ path, signedUrl: `https://photos.test/${path}` }))) }),
    },
  }),
}));

let client: QueryClient;
let tree: ReactTestRenderer;

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
const screen = () => (
  <QueryClientProvider client={client}>
    <PackScreen />
  </QueryClientProvider>
);
const button = () => tree.root.findAll((node) => node.props.label === 'Show older')[0];
const loadFailed = () => tree.root.findAll((node) => typeof node.props.onRetry === 'function')[0];
const chips = () => tree.root.findAll((node) => node.props.accessibilityLabel === 'React with 🔥' && typeof node.props.onPress === 'function');
/** What the list went through, leaving out renders that changed nothing in it. */
const sizes = () => mockLists.map((list) => `${list.photos}p+${list.events}e`).filter((size, index, all) => size !== all[index - 1]);

async function open() {
  await act(async () => {
    tree = create(screen());
  });
  await advance(2000);
}

async function showOlder() {
  mockLists.length = 0;
  await act(async () => button()?.props.onPress());
}

beforeEach(() => {
  jest.useFakeTimers({ now: Date.parse('2026-10-31T12:00:10Z') });
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  mockScreen.id = 'a';
  mockScreen.olderFails = false;
  mockLists.length = 0;
  mockMounts.unmounts = 0;
  mockReacted.clear();
});

afterEach(async () => {
  await act(async () => tree.unmount());
  client.clear();
  jest.useRealTimers();
});

describe('Show older', () => {
  it('keeps the list on screen until the longer page lands, with the older events out of it', async () => {
    await open();

    await showOlder();
    await advance(50);
    expect(mockMounts.unmounts).toBe(0);
    expect(button()?.props.loading).toBe(true);

    await advance(3000);
    expect(mockMounts.unmounts).toBe(0);
    expect(sizes()).toEqual(['30p+2e', '60p+3e']);
    expect(button()?.props.loading).toBeFalsy();
  });

  it('still lands when a reaction is tapped during the load, and the reaction stays', async () => {
    await open();
    await showOlder();
    await advance(50);
    expect(chips()).toHaveLength(30);

    await act(async () => chips().at(-1)?.props.onPress());
    await advance(5000);

    expect(sizes().at(-1)).toBe('60p+3e');
    expect(button()?.props.loading).toBeFalsy();
    expect(mockReacted.get('a29')).toBe('fire');
    expect(chips()[29]?.props.accessibilityState).toEqual({ selected: true });
  });

  it('keeps the list when the longer page fails for good, says so, and can try again', async () => {
    await open();
    mockScreen.olderFails = true;

    await showOlder();
    await advance(10_000);
    expect(mockMounts.unmounts).toBe(0);
    expect(sizes().at(-1)).toBe('30p+2e');
    expect(button()).toBeUndefined();
    expect(loadFailed()).toBeDefined();

    mockScreen.olderFails = false;
    await act(async () => loadFailed()?.props.onRetry());
    await advance(50);
    expect(button()?.props.loading).toBe(true);
    expect(loadFailed()).toBeUndefined();

    await advance(3000);
    expect(mockMounts.unmounts).toBe(0);
    expect(sizes().at(-1)).toBe('60p+3e');
  });

  it('never shows one pack under the name of another when a link changes the pack on this screen', async () => {
    await open();
    mockLists.length = 0;

    mockScreen.id = 'b';
    await act(async () => tree.update(screen()));
    await advance(50);
    expect(mockLists).toHaveLength(0);

    await advance(3000);
    expect(new Set(mockLists.map((list) => list.first))).toEqual(new Set(['b0']));
  });
});
