import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import * as AppLayout from '@/app/(app)/_layout';
import PackScreen from '@/app/(app)/pack/[id]/index';
import { NEW_SCREEN } from '@/lib/navigation';

// The real router, the app's own stack and the real pack screen, with the real celebration logic,
// over stand-ins for what the screen reads. A link reaches the router the way it does on a phone:
// through the listener on expo-linking.
let mockLinkListener: ((event: { url: string }) => void) | null = null;
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path: string) => `gozali://${path}`,
  resolveScheme: () => 'gozali',
  addEventListener: (_event: string, listener: (event: { url: string }) => void) => {
    mockLinkListener = listener;
    return { remove: () => undefined };
  },
}));
jest.mock('@/components/ActionMenu', () => {
  const { Text } = jest.requireActual('react-native');
  return { ActionMenu: ({ menu }: { menu: { title: string } | null }) => (menu ? <Text>{menu.title}</Text> : null) };
});
jest.mock('@/components/Coins', () => ({ Coins: () => null }));
jest.mock('@/components/HealthBar', () => ({ HealthBar: () => null }));
jest.mock('@/components/MemberCircles', () => {
  const { Button } = jest.requireActual('@/components/Button');
  return {
    MemberCircles: ({ onMenu }: { onMenu: (member: { id: string; name: string }) => void }) => (
      <Button label="Menu for Dan" onPress={() => onMenu({ id: 'dan', name: 'Dan' })} />
    ),
  };
});
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/critter/HatchSteps', () => ({ HatchSteps: () => null }));
jest.mock('@/features/critter/MilestoneMoment', () => {
  const { Button } = jest.requireActual('@/components/Button');
  return {
    MilestoneMoment: ({ name, onClose }: { name: string; onClose: () => void }) => <Button label={`Yay ${name}`} onPress={onClose} />,
  };
});
jest.mock('@/features/critter/hatch', () => ({ hatchesAtClose: () => false, hatchesTonight: () => false }));
jest.mock('@/features/critter/useCritterText', () => ({
  useCritterText: (critter: { name: string }) => ({ name: critter.name, label: critter.name, lines: [] }),
}));
jest.mock('@/features/days/api', () => ({
  isPausedToday: () => false,
  useDayStatus: () => ({ data: undefined }),
  useMembersToday: () => ({ data: undefined }),
  useTodayPasses: () => ({ data: undefined }),
}));
const mockFeedReads: { packId: string; limit: number }[] = [];
jest.mock('@/features/feeds/api', () => ({
  FEED_PAGE: 30,
  fedToday: () => new Set(),
  useCountedFeeds: () => ({ data: [] }),
  useFeedQueue: () => undefined,
  usePackFeed: (packId: string, limit: number) => {
    mockFeedReads.push({ packId, limit });
    return { data: Array.from({ length: limit }, (_, index) => ({ id: `${packId}${index}`, created_at: '2026-11-01T00:00:00Z' })) };
  },
  usePendingFeeds: () => ({ data: [] }),
}));
jest.mock('@/features/feeds/FeedList', () => ({ FeedList: () => null }));
const mockPacks = new Map<string, unknown>();
jest.mock('@/features/packs/api', () => ({
  countedToday: (pack: { pack_members: unknown[] }) => pack.pack_members,
  currentMembers: (pack: { pack_members: unknown[] }) => pack.pack_members,
  restDaysOn: () => 1,
  usePack: (id: string) => ({ ...(mockPacks.get(id) as object), isPending: false, isError: false, refetch: async () => undefined }),
}));
jest.mock('@/features/packs/realtime', () => ({ usePackRealtime: () => undefined }));
jest.mock('@/features/profile/avatar', () => ({ useAvatarUrls: () => ({ data: new Map() }) }));
jest.mock('@/features/profile/useProfile', () => ({ useAccountSync: () => undefined }));
jest.mock('@/features/social/NameMeCard', () => ({ NameMeCard: () => null }));
jest.mock('@/features/social/api', () => ({
  socialErrorKey: () => 'errors.loadFailed',
  useBlockedIds: () => ({ data: new Set() }),
  useNudge: () => ({ mutate: () => undefined }),
  usePackEvents: () => ({ data: [] }),
  useReact: () => ({ mutate: () => undefined }),
}));
jest.mock('@/features/social/moderation', () => ({
  useModeration: () => ({ memberActions: () => [], photoMenu: () => null }),
}));
jest.mock('@/features/widgets/sync', () => ({ useWidgetSync: () => undefined }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: () => undefined, success: () => undefined } }));
jest.mock('@/lib/notifications', () => ({ useNotificationRoutes: () => undefined }));

const routes = {
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/_layout': AppLayout,
  '(app)/index': { default: () => <Text>home</Text> },
  '(app)/pack/[id]/index': { default: PackScreen },
  '(app)/pack/[id]/feed': { default: () => <Text>camera</Text> },
  '(app)/pack/[id]/not-today': { default: () => <Text>not today</Text> },
};

const PACK_A = '/pack/a';
const LINK_TO_B = 'gozali://pack/b';
const GONE_BEFORE = 1;
/** Later than any screen in these tests opens. */
const JUST_READ = Date.now() + 3_600_000;

const member = { user_id: 'me', role: 'admin', status: 'active', joined_at: '2026-01-01T00:00:00Z', profiles: { display_name: 'Me', avatar_path: null } };

/** A pack whose critter hatched, as read at `dataUpdatedAt`. */
function hatched(id: string, name: string, dataUpdatedAt: number) {
  return {
    data: {
      id,
      name,
      category: 'gym',
      custom_habit: null,
      timezone: 'UTC',
      rest_days_per_week: 1,
      pack_members: [member],
      critters: { species: 'kit', name, health: 80, xp: 40, stage: 'baby', status: 'active', streak: 3, coins: 100, marks: [], outfit: {} },
    },
    dataUpdatedAt,
  };
}

const sawTheEgg = (packId: string) => AsyncStorage.setItem(`gozali.seen.${packId}`, JSON.stringify({ status: 'egg', stage: 'egg' }));
const seen = async (packId: string) => JSON.parse((await AsyncStorage.getItem(`gozali.seen.${packId}`)) ?? 'null')?.status;

let app: ReactTestRenderer;

async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
  }
}

async function go(move: () => void) {
  await act(async () => move());
  await settle();
}

async function openPackA() {
  await act(async () => {
    app = create(
      <QueryClientProvider client={new QueryClient()}>
        <ExpoRoot context={getMockContext(routes as never)} location="/" />
      </QueryClientProvider>,
    );
  });
  await settle();
  await go(() => router.push(PACK_A as Href));
}

const followLink = (url: string) => go(() => mockLinkListener?.({ url }));
const appStack = () =>
  store.state?.routes[0]?.state?.routes[0]?.state?.routes.map(({ name, params }) =>
    `${name} ${(params as { id?: string } | undefined)?.id ?? ''}`.trim(),
  );
const buttons = (label: string) => app.root.findAll((node) => node.props.label === label && node.props.onPress);
/** Presses the button on the screen in front, which comes last. */
const press = async (label: string) => {
  await act(async () => buttons(label).at(-1)?.props.onPress());
  await settle();
};

beforeEach(async () => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  await AsyncStorage.clear();
  mockFeedReads.length = 0;
  mockPacks.clear();
  mockPacks.set('a', hatched('a', 'Aya', JUST_READ));
  mockPacks.set('b', hatched('b', 'Bo', JUST_READ));
});

afterEach(async () => {
  await act(async () => app.unmount());
  jest.useRealTimers();
});

describe('a link to another pack with a pack open', () => {
  it('leaves the celebration with its pack, and the other critter waits for its own', async () => {
    await sawTheEgg('a');
    await sawTheEgg('b');
    // What the phone kept of the other pack, from before this screen opened.
    mockPacks.set('b', hatched('b', 'Bo', GONE_BEFORE));
    await openPackA();
    expect(buttons('Yay Aya')).toHaveLength(1);

    await followLink(LINK_TO_B);
    expect(buttons('Yay Bo')).toHaveLength(0);

    await press('Yay Aya');
    expect(await seen('a')).toBe('active');
    expect(await seen('b')).toBe('egg');
  });

  it('leaves an open menu with its pack', async () => {
    await openPackA();
    await press('Menu for Dan');

    await followLink(LINK_TO_B);

    expect(appStack()).toEqual(['index', 'pack/[id]/index a', 'pack/[id]/index b']);
  });

  it('starts the other pack on the first page of photos, and the first keeps its place', async () => {
    await openPackA();
    await press('Show older');

    await followLink(LINK_TO_B);

    expect(mockFeedReads.filter((read) => read.packId === 'b').map((read) => read.limit)).toEqual(expect.not.arrayContaining([60]));

    await go(() => router.back());
    expect(mockFeedReads.filter((read) => read.packId === 'a').at(-1)?.limit).toBe(60);
  });

  it('goes back to that pack when it stands underneath', async () => {
    await openPackA();
    await followLink(LINK_TO_B);

    await followLink('gozali://pack/a');

    expect(appStack()).toEqual(['index', 'pack/[id]/index a']);
  });

  it('stays on that pack when it is the one open', async () => {
    await openPackA();
    await press('Show older');

    await followLink('gozali://pack/a');

    expect(appStack()).toEqual(['index', 'pack/[id]/index a']);
    expect(mockFeedReads.at(-1)).toEqual({ packId: 'a', limit: 60 });
  });
});

describe('Feed on a pack opened over its own camera', () => {
  it('opens a new camera, and moves nothing', async () => {
    await openPackA();
    await go(() => router.push('/pack/a/feed', NEW_SCREEN));
    await go(() => router.push(PACK_A as Href, NEW_SCREEN));

    await press('Feed');

    expect(appStack()).toEqual(['index', 'pack/[id]/index a', 'pack/[id]/feed a', 'pack/[id]/index a', 'pack/[id]/feed a']);
  });
});
