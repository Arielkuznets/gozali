import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import HomeScreen from '@/app/(app)/index';
import PackScreen from '@/app/(app)/pack/[id]/index';
import { countedFeedsKey, useSendFeed } from '@/features/feeds/api';
import type { OutgoingFeed } from '@/features/feeds/send';
import { packsKey, type Pack, type PackMember } from '@/features/packs/api';

// The real screens, hooks and queue with no connection: every read fails as it does on a phone, and
// what the screens can show comes from what the phone holds.
const mockNoAnswer = { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
jest.mock('@/lib/supabase', () => {
  const read: Record<string, unknown> = {
    then: (done: (answer: typeof mockNoAnswer) => void) => done(mockNoAnswer),
    maybeSingle: async () => mockNoAnswer,
  };
  for (const step of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) read[step] = () => read;
  return {
    supabase: null,
    storedSession: async () => ({ user: { id: 'noa' } }),
    requireSupabase: () => ({ from: () => read, rpc: async () => mockNoAnswer }),
  };
});
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: false, isInternetReachable: false }),
  addEventListener: () => () => undefined,
}));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    async copy() {}
    delete() {}
  }
  class Directory extends File {
    create() {}
  }
  return { File, Directory, Paths: { document: { uri: 'documents' } } };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'gym' }),
  router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/components/ActionMenu', () => ({ ActionMenu: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/critter/MilestoneMoment', () => ({ MilestoneMoment: () => null }));
jest.mock('@/features/critter/milestones', () => ({ useMilestone: () => ({ milestone: null, dismiss: () => undefined }) }));
jest.mock('@/features/feeds/FeedList', () => ({ FeedList: () => null }));
jest.mock('@/features/packs/realtime', () => ({ usePackRealtime: () => undefined }));
jest.mock('@/features/profile/avatar', () => ({ useAvatarUrls: () => ({ data: new Map() }) }));
jest.mock('@/features/social/NameMeCard', () => ({ NameMeCard: () => null }));
jest.mock('@/features/social/api', () => ({
  socialErrorKey: () => 'errors.saveFailed',
  useBlockedIds: () => ({ data: new Set() }),
  useNudge: () => ({ mutate: () => undefined }),
  usePackEvents: () => ({ data: [] }),
  useReact: () => ({ mutate: () => undefined }),
}));
jest.mock('@/features/social/moderation', () => ({ useModeration: () => ({ memberActions: () => [], photoMenu: () => null }) }));

const member = (user_id: string): PackMember => ({
  user_id,
  role: 'member',
  status: 'active',
  joined_at: '2026-10-01T10:00:00Z',
  profiles: { display_name: user_id, avatar_path: null },
});

const PACK: Pack = {
  id: 'gym',
  name: 'Gym squad',
  category: 'gym',
  custom_habit: null,
  rest_days_per_week: 0,
  week_start: 'sunday',
  invite_code: 'ABCD2345',
  pending_rest_days_per_week: null,
  pending_week_start: null,
  pending_from: null,
  timezone: 'Asia/Jerusalem',
  critters: { species: 'kit', name: 'Pixel', health: 80, xp: 3, stage: 'baby', status: 'active', streak: 1, coins: 0, marks: [], outfit: {} },
  pack_members: [member('noa'), member('dan')],
};

const FEED_ON_CARD = 'Feed Gym squad';
const HOUR = 3_600_000;

let client: QueryClient;
let send: ReturnType<typeof useSendFeed>['mutateAsync'];
const screens: ReactTestRenderer[] = [];

/** The camera, which stays usable however the screens below it read. */
function Camera() {
  const { mutateAsync } = useSendFeed();
  useEffect(() => {
    send = mutateAsync;
  });
  return null;
}

function feed(overrides: Partial<OutgoingFeed> = {}): OutgoingFeed {
  return {
    id: 'photo',
    packId: PACK.id,
    userId: 'noa',
    photoUri: 'cache/photo.jpg',
    caption: null,
    capturedAt: new Date().toISOString(),
    focusMinutes: null,
    extra: false,
    ...overrides,
  };
}

// A query observer hears about a change in a macrotask.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

async function open(ui: ReactElement) {
  let screen!: ReactTestRenderer;
  await act(async () => {
    screen = create(
      <QueryClientProvider client={client}>
        <Camera />
        {ui}
      </QueryClientProvider>,
    );
  });
  await settle();
  screens.push(screen);
  return screen;
}

async function feedOffline(overrides?: Partial<OutgoingFeed>) {
  let outcome: unknown;
  await act(async () => {
    outcome = await send(feed(overrides));
  });
  await settle();
  expect(outcome).toBe('queued');
}

const lines = (screen: ReactTestRenderer) =>
  screen.root
    .findAll((node) => node.type === 'Text')
    .map((node) => [node.props.children].flat(Infinity).join(''));

/** What can be pressed, by what a screen reader says or by the words on it. */
const buttons = (screen: ReactTestRenderer) =>
  screen.root
    .findAll((node) => node.props.accessibilityRole === 'button' && typeof node.type === 'string')
    .map((node) => node.props.accessibilityLabel ?? lines({ root: node } as ReactTestRenderer).join(''));

/** A phone with these people's feeds of today, as the copy kept on it has them. */
function phoneWhereFed(...members: string[]) {
  // No garbage collection, whose timers would outlive the test.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  client.setQueryData(packsKey, [PACK]);
  const day = new Date(Date.now() - 3 * HOUR).toLocaleDateString('en-CA', { timeZone: PACK.timezone });
  client.setQueryData(countedFeedsKey, members.map((user_id) => ({ pack_id: PACK.id, user_id, day })));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  phoneWhereFed('dan');
});

afterEach(async () => {
  await act(async () => {
    for (const screen of screens.splice(0)) screen.unmount();
  });
});

describe('a feed waiting on this phone', () => {
  it('takes Feed off the card on home, and the count waits for the server', async () => {
    const home = await open(<HomeScreen />);
    expect(buttons(home)).toContain(FEED_ON_CARD);

    await feedOffline();

    expect(buttons(home)).not.toContain(FEED_ON_CARD);
    expect(lines(home)).toContain('1/2 fed today');
  });

  it('turns the pack to the part being done, and Feed to Post another photo', async () => {
    const pack = await open(<PackScreen />);
    expect(buttons(pack)).toEqual(expect.arrayContaining(['Feed', 'Not today']));

    await feedOffline();

    expect(buttons(pack)).not.toContain('Feed');
    expect(buttons(pack)).not.toContain('Not today');
    expect(buttons(pack)).toContain('Post another photo');
    expect(lines(pack)).toContain('Your part is done for today ✓');
    expect(lines(pack)).toEqual(expect.arrayContaining(['1/2 fed today', '1 feed waiting to go out']));
  });

  it('still counts after a start with no connection', async () => {
    await open(<></>);
    await feedOffline();

    phoneWhereFed('dan');
    const home = await open(<HomeScreen />);
    const pack = await open(<PackScreen />);

    expect(buttons(home)).not.toContain(FEED_ON_CARD);
    expect(buttons(pack)).not.toContain('Feed');
  });

  it('leaves Feed on offer when it waits from a day before', async () => {
    await open(<></>);
    await feedOffline({ capturedAt: new Date(Date.now() - 26 * HOUR).toISOString() });

    const home = await open(<HomeScreen />);
    const pack = await open(<PackScreen />);

    expect(buttons(home)).toContain(FEED_ON_CARD);
    expect(buttons(pack)).toEqual(expect.arrayContaining(['Feed', 'Not today']));
    expect(lines(pack)).toContain('1 feed waiting to go out');
  });

  it('leaves Feed on offer when it is an extra post', async () => {
    await open(<></>);
    await feedOffline({ extra: true });

    expect(buttons(await open(<HomeScreen />))).toContain(FEED_ON_CARD);
    expect(buttons(await open(<PackScreen />))).toContain('Feed');
  });

  it('leaves Feed on offer when it belongs to another account', async () => {
    await open(<></>);
    await feedOffline({ userId: 'dan' });

    expect(buttons(await open(<HomeScreen />))).toContain(FEED_ON_CARD);
    expect(buttons(await open(<PackScreen />))).toContain('Feed');
  });

  it('leaves Feed on offer in the other packs', async () => {
    await open(<></>);
    await feedOffline({ packId: 'other' });

    expect(buttons(await open(<HomeScreen />))).toContain(FEED_ON_CARD);
  });
});
