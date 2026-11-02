// What a clock tick, a changed photo and a reaction render on the pack screen, over the real hooks and
// a real QueryClient. Plain Jest leaves the React Compiler out and then no handler is stable, so the
// three files involved go through it here, with the options Metro gives it for a release build.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ComponentType, ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { packFeedsKey, type FeedItem } from '@/features/feeds/api';
import type { Menu } from '@/components/ActionMenu';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const babel = require('@babel/core');

// The first mount loads the whole screen.
jest.setTimeout(60_000);

const mobile = path.resolve(__dirname, '..');
const mockTexts = jest.fn();
const mockRpc = jest.fn();
const mockSaved = jest.fn();
const mockViewed = jest.fn();
const mockMenu = jest.fn();
const mockCompiled: { FeedList?: ComponentType<Record<string, unknown>>; useModeration?: (onBlocked?: () => void) => unknown } = {};

jest.mock('expo-router', () => ({ useFocusEffect: () => undefined, useLocalSearchParams: () => ({ id: 'p' }), router: { push: () => undefined } }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({}));
jest.mock('@/components/AppText', () => ({
  AppText: ({ children }: { children?: ReactNode }) => {
    mockTexts(children);
    return children ?? null;
  },
}));
jest.mock('@/components/ActionMenu', () => ({
  ActionMenu: ({ menu }: { menu: unknown }) => {
    mockMenu(menu);
    return null;
  },
}));
jest.mock('@/components/Button', () => ({ Button: () => null }));
jest.mock('@/components/Coins', () => ({ Coins: () => null }));
jest.mock('@/components/HealthBar', () => ({ HealthBar: () => null }));
jest.mock('@/components/HeaderButton', () => ({ HeaderButton: () => null }));
jest.mock('@/components/MemberCircles', () => ({ MemberCircles: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/components/ScreenStates', () => ({ LoadingScreen: () => null, LoadFailedScreen: () => null, PackMissingScreen: () => null }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u0' } } }) }));
jest.mock('@/features/profile/avatar', () => ({ useAvatarUrls: () => ({ data: new Map() }) }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/critter/HatchSteps', () => ({ HatchSteps: () => null }));
jest.mock('@/features/critter/hatch', () => ({ hatchesAtClose: () => false, hatchesTonight: () => false }));
jest.mock('@/features/critter/MilestoneMoment', () => ({ MilestoneMoment: () => null }));
jest.mock('@/features/critter/milestones', () => ({ useMilestone: () => ({ milestone: null, dismiss: () => undefined }) }));
jest.mock('@/features/critter/useCritterText', () => ({ useCritterText: () => ({ name: 'Kit', label: 'Kit', lines: [] }) }));
jest.mock('@/features/feeds/PhotoViewer', () => ({
  PhotoViewer: ({ photo }: { photo: unknown }) => {
    mockViewed(photo);
    return null;
  },
}));
jest.mock('@/features/feeds/queue', () => ({ pendingFeeds: async () => [] }));
jest.mock('@/features/feeds/send', () => ({}));
jest.mock('@/features/packs/realtime', () => ({ usePackRealtime: () => undefined }));
jest.mock('@/features/social/NameMeCard', () => ({ NameMeCard: () => null }));
jest.mock('@/lib/confirm', () => ({ confirm: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(), notify: () => undefined }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: () => undefined, success: () => undefined } }));
jest.mock('@/lib/navigation', () => ({ goBack: () => undefined }));
jest.mock('@/lib/reportError', () => ({ errorCode: () => undefined, reportError: () => undefined }));
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  requireSupabase: () => {
    const read: Record<string, unknown> = {
      select: () => read,
      eq: () => read,
      order: () => read,
      limit: () => read,
      gte: () => read,
      lte: () => read,
      upsert: (row: unknown) => {
        mockSaved(row);
        return read;
      },
      then: (done: (answer: unknown) => void) => done({ data: [], error: null }),
    };
    return { rpc: (...args: unknown[]) => mockRpc(...args), from: () => read };
  },
}));
jest.mock('@/features/feeds/FeedList', () => ({
  FeedList: (props: Record<string, unknown>) => {
    const List = mockCompiled.FeedList!;
    return <List {...props} />;
  },
}));
jest.mock('@/features/social/moderation', () => ({ useModeration: (onBlocked?: () => void) => mockCompiled.useModeration!(onBlocked) }));

function compiled<T>(relative: string): T {
  const file = path.join(mobile, relative);
  const out = babel.transformSync(readFileSync(file, 'utf8'), {
    filename: file,
    cwd: mobile,
    babelrc: false,
    configFile: false,
    presets: [require.resolve('babel-preset-expo')],
    caller: { name: 'metro', bundler: 'metro', platform: 'ios', isDev: false, isServer: false, supportsReactCompiler: true, projectRoot: mobile, engine: 'hermes', isHMREnabled: false },
  });
  expect(out.code).toMatch(/compiler-runtime/);
  const loaded = { exports: {} as T };
  new Function('require', 'module', 'exports', out.code)(require, loaded, loaded.exports);
  return loaded.exports;
}

const PACK_KEY = ['packs', 'p'];
const FEED_KEY = [...packFeedsKey, 'p', 30];
const member = (index: number, name = `Member ${index}`) => ({
  user_id: `u${index}`,
  role: index === 0 ? 'admin' : 'member',
  status: 'active',
  joined_at: '2026-01-01T00:00:00+00:00',
  profiles: { display_name: name, avatar_path: null },
});
const pack = {
  id: 'p',
  name: 'Pack',
  category: 'reading',
  custom_habit: null,
  timezone: 'UTC',
  rest_days_per_week: 1,
  pack_members: [0, 1, 2, 3].map((index) => member(index)),
  critters: { species: 'kit', name: 'Kit', health: 80, xp: 500, stage: 'adult', status: 'active', streak: 3, coins: 100, marks: [], outfit: {} },
};
// Newest first, half a day apart, and the first one is from today, in the zone the tests run in.
const NOW = new Date(2026, 9, 31, 12, 0, 10);
const feeds = Array.from({ length: 30 }, (_, index) => ({
  id: `f${index}`,
  pack_id: 'p',
  user_id: `u${index % 4}`,
  created_at: new Date(2026, 9, 31, 8 - index * 12).toISOString(),
  day: '2026-10-30',
  is_extra: false,
  photo_path: null,
  photoUrl: `https://example.test/${index}.jpg`,
  caption: null,
  focus_minutes: null,
  reactions: [],
})) as FeedItem[];
const FIRE = [{ feed_id: 'f2', emoji: 'fire', total: 1, mine: true, names: ['Member 0'] }];

/** One row is under ten texts. All 30 rows are well over a hundred. */
const ONE_ROW = 20;

let PackScreen: ComponentType;
let tree: ReactTestRenderer;
let client: QueryClient;

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
const withOnPress = (match: (props: Record<string, unknown>) => boolean) =>
  tree.root.findAll((node) => typeof node.props.onPress === 'function' && match(node.props));
const chips = () => withOnPress((props) => props.accessibilityLabel === 'React with 🔥');
const photos = () => withOnPress((props) => props.accessibilityRole === 'imagebutton');
const moreButtons = () => withOnPress((props) => props.accessibilityLabel === 'More');
const shownTexts = () => mockTexts.mock.calls.flat(2).filter((text): text is string => typeof text === 'string');

beforeAll(() => {
  mockCompiled.FeedList = compiled<{ FeedList: ComponentType<Record<string, unknown>> }>('src/features/feeds/FeedList.tsx').FeedList;
  mockCompiled.useModeration = compiled<{ useModeration: (onBlocked?: () => void) => unknown }>('src/features/social/moderation.ts').useModeration;
  PackScreen = compiled<{ default: ComponentType }>('src/app/(app)/pack/[id]/index.tsx').default;
}, 60_000);

beforeEach(async () => {
  jest.useFakeTimers({ now: NOW });
  mockRpc.mockReset();
  mockSaved.mockReset();
  mockViewed.mockReset();
  mockMenu.mockReset();
  mockRpc.mockImplementation(async (name: string) => ({ data: name === 'feed_reactions' ? FIRE : [], error: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(PACK_KEY, pack);
  client.setQueryData(FEED_KEY, feeds);
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <PackScreen />
      </QueryClientProvider>,
    );
  });
  await advance(10);
  mockTexts.mockClear();
});

afterEach(async () => {
  await act(async () => tree.unmount());
  client.clear();
  jest.useRealTimers();
});

describe('the photo rows of the pack screen', () => {
  it('stay as they are through a clock tick', async () => {
    await advance(30_000);

    expect(mockTexts.mock.calls.length).toBeLessThan(ONE_ROW);
  });

  it('render one row when one photo changes', async () => {
    await act(async () => {
      client.setQueryData(
        FEED_KEY,
        feeds.map((feed, index) => (index === 3 ? { ...feed, reactions: [{ emoji: 'clap', total: 1, mine: false, names: ['Dan'] }] } : feed)),
      );
    });
    await advance(10);

    expect(mockTexts.mock.calls.length).toBeLessThan(ONE_ROW);
  });

  it('take the date when their day is over', async () => {
    jest.setSystemTime(new Date(2026, 10, 1, 12, 0, 10));
    await advance(30_000);

    expect(shownTexts().some((text) => text.startsWith('Oct 31, '))).toBe(true);
  });

  it('take a changed name', async () => {
    const renamed = { ...pack, pack_members: [member(0), member(1, 'Dana'), member(2), member(3)] };
    await act(async () => {
      client.setQueryData(PACK_KEY, renamed);
    });
    await advance(10);

    expect(shownTexts()).toContain('Dana');
    await act(async () => moreButtons()[0]?.props.onPress());
    expect(mockMenu).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Dana' }));
  });

  it('open a photo on the link and name of the moment', async () => {
    await act(async () => {
      client.setQueryData(
        FEED_KEY,
        feeds.map((feed, index) => (index === 1 ? { ...feed, photoUrl: 'https://example.test/newer.jpg' } : feed)),
      );
    });
    await advance(10);

    await act(async () => photos()[1]?.props.onPress());

    expect(mockViewed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'f1', url: 'https://example.test/newer.jpg', name: 'Member 1' }));
  });
});

describe('a reaction on the pack screen', () => {
  it('shows on the chip and takes the totals of the server', async () => {
    await act(async () => chips()[2]?.props.onPress());
    await advance(10);

    expect(mockRpc).toHaveBeenCalledWith('react', { target_feed: 'f2', emoji: 'fire' });
    expect(client.getQueryData<FeedItem[]>(FEED_KEY)?.[2]?.reactions).toEqual([{ emoji: 'fire', total: 1, mine: true, names: ['Member 0'] }]);
    expect(chips()[2]?.props.accessibilityState).toEqual({ selected: true });
  });

  it('renders the row it changed, not the 30 of them', async () => {
    await act(async () => chips()[2]?.props.onPress());
    await advance(10);

    expect(mockTexts.mock.calls.length).toBeLessThan(ONE_ROW);
  });
});

describe('the menu of a row', () => {
  // The first row is the user's own and has no menu, so the first ⋯ is on Member 1's photo.
  const openMenu = async () => {
    await act(async () => moreButtons()[0]?.props.onPress());
    return mockMenu.mock.lastCall?.[0] as Menu;
  };

  it('reports the photo of that row', async () => {
    const menu = await openMenu();
    await act(async () => menu.actions[0]?.onPress());
    await advance(10);

    expect(mockSaved).toHaveBeenCalledWith({ feed_id: 'f1', reporter_id: 'u0', reason: null });
  });

  it('blocks the member of that row', async () => {
    const menu = await openMenu();
    await act(async () => menu.actions[1]?.onPress());
    await advance(10);

    expect(mockSaved).toHaveBeenCalledWith({ blocker_id: 'u0', blocked_id: 'u1' });
  });
});
