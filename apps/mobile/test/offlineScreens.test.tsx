import { addDays, packDayOf } from '@gozali/game-engine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import HomeScreen from '@/app/(app)/index';
import FeedScreen from '@/app/(app)/pack/[id]/feed';
import PackScreen from '@/app/(app)/pack/[id]/index';
import { countedFeedsKey, useSendFeed } from '@/features/feeds/api';
import type { OutgoingFeed } from '@/features/feeds/send';
import { packsKey, type Pack, type PackMember, type PackPause } from '@/features/packs/api';

// The real screens, hooks and queue with no connection: every read fails as it does on a phone, and
// what the screens can show comes from what the phone holds.
const mockNoAnswer = { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
/** The server's day status, for the moment the connection is back. */
let mockStatus: unknown = null;
jest.mock('@/lib/supabase', () => {
  const read: Record<string, unknown> = {
    then: (done: (answer: typeof mockNoAnswer) => void) => done(mockNoAnswer),
    maybeSingle: async () => mockNoAnswer,
  };
  for (const step of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) read[step] = () => read;
  return {
    supabase: null,
    storedSession: async () => ({ user: { id: 'noa' } }),
    requireSupabase: () => ({
      from: () => read,
      rpc: async (name: string) => (name === 'my_day_status' && mockStatus ? { data: mockStatus, error: null } : mockNoAnswer),
    }),
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
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, async () => undefined, async () => undefined],
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({}));
const mockCancelled = jest.fn();
jest.mock('expo-notifications', () => ({ cancelScheduledNotificationAsync: async (id: string) => mockCancelled(id) }));
const mockDismissTo = jest.fn();
let mockParams: Record<string, string>;
/** What a screen runs when it comes back to the front, as long as it is mounted. */
const mockOnFocus = new Set<() => void>();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useLocalSearchParams: () => mockParams,
    useIsFocused: () => true,
    useFocusEffect: (run: () => void) =>
      useEffect(() => {
        mockOnFocus.add(run);
        run();
        return () => void mockOnFocus.delete(run);
      }, [run]),
    router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn(), dismissTo: (href: string) => mockDismissTo(href) },
  };
});
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/components/ActionMenu', () => ({ ActionMenu: () => null }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/critter/MilestoneMoment', () => ({ MilestoneMoment: () => null }));
jest.mock('@/features/critter/milestones', () => ({ useMilestone: () => ({ milestone: null, dismiss: () => undefined }) }));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
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

const packDay = () => packDayOf(new Date(), PACK.timezone);

/** A phone holding a kept copy of this pack, and the feeds of today of these people. */
function phone({ pack = PACK, fed = ['dan'] }: { pack?: Pack; fed?: string[] } = {}) {
  // No garbage collection, whose timers would outlive the test.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  client.setQueryData(packsKey, [pack]);
  client.setQueryData(countedFeedsKey, fed.map((user_id) => ({ pack_id: pack.id, user_id, day: packDay() })));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockStatus = null;
  mockParams = { id: PACK.id };
  mockCancelled.mockReset();
  mockDismissTo.mockReset();
  phone();
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

    phone();
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

const running = (): PackPause => ({ starts_on: addDays(packDay(), -1), ends_on: addDays(packDay(), 5) });
const onPause = (pause: PackPause, pack = PACK): Pack => ({
  ...pack,
  pack_members: pack.pack_members.map((member) => (member.user_id === 'noa' ? { ...member, pauses: [pause] } : member)),
});

describe('a pause, with only the pack copy to go by', () => {
  const STUDY: Pack = { ...PACK, category: 'study' };
  const hasLabel = (screen: ReactTestRenderer, label: string) =>
    screen.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.type === 'string').length > 0;

  it('shows on the card instead of Feed, and leaves the member out of the count', async () => {
    phone({ pack: onPause(running()) });
    const home = await open(<HomeScreen />);

    expect(buttons(home)).not.toContain(FEED_ON_CARD);
    expect(hasLabel(home, 'On a pause')).toBe(true);
    expect(lines(home)).toContain('1/1 fed today');
  });

  it('shows on the pack, which offers no photo', async () => {
    phone({ pack: onPause(running(), STUDY) });
    const pack = await open(<PackScreen />);

    expect(lines(pack).join()).toContain("You're on a pause until");
    expect(buttons(pack)).toContain('noa, on a pause');
    for (const offer of ['Feed', 'Not today', 'Focus', 'Post another photo']) expect(buttons(pack)).not.toContain(offer);
  });

  it('sends a link to the camera to the pack', async () => {
    phone({ pack: onPause(running()) });
    await open(<FeedScreen />);

    expect(mockDismissTo).toHaveBeenCalledWith('/pack/gym');
  });

  it.each([
    ['waiting to start', (): PackPause => ({ starts_on: addDays(packDay(), 1), ends_on: addDays(packDay(), 7) })],
    ['over', (): PackPause => ({ starts_on: addDays(packDay(), -8), ends_on: addDays(packDay(), -1) })],
  ])('changes nothing when it is %s', async (_name, pause) => {
    phone({ pack: onPause(pause(), STUDY) });

    expect(buttons(await open(<HomeScreen />))).toContain(FEED_ON_CARD);
    expect(buttons(await open(<PackScreen />))).toEqual(expect.arrayContaining(['Feed', 'Not today', 'Focus']));
    await open(<FeedScreen />);
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('offers Feed on a copy with no word of pauses, as an older build kept it', async () => {
    expect(buttons(await open(<HomeScreen />))).toContain(FEED_ON_CARD);
    expect(buttons(await open(<PackScreen />))).toContain('Feed');
  });

  it('gives way to what the server says when it can answer', async () => {
    phone({ pack: onPause(running()) });
    mockStatus = { day: packDay(), passToday: null, fedToday: false, pause: null };
    const pack = await open(<PackScreen />);

    expect(buttons(pack)).toContain('Feed');
    expect(lines(pack).join()).not.toContain("You're on a pause until");
  });
});

describe('a member who fell asleep', () => {
  const ONE_PHOTO = 'One photo and you';
  const asleep = (pack = PACK): Pack => ({
    ...pack,
    pack_members: pack.pack_members.map((member) => (member.user_id === 'noa' ? { ...member, status: 'sleeping' } : member)),
  });

  it('hears that one photo brings them back, and has Feed for it', async () => {
    phone({ pack: asleep() });
    const pack = await open(<PackScreen />);

    expect(lines(pack).join()).toContain(ONE_PHOTO);
    expect(buttons(pack)).toContain('Feed');
  });

  it('hears only of the pause while one runs, which has no Feed', async () => {
    const pause = running();
    phone({ pack: asleep(onPause(pause)) });
    mockStatus = { day: packDay(), passToday: null, fedToday: false, pause: { startsOn: pause.starts_on, endsOn: pause.ends_on } };
    const pack = await open(<PackScreen />);

    expect(lines(pack).join()).toContain("You're on a pause until");
    expect(lines(pack).join()).not.toContain(ONE_PHOTO);
    expect(buttons(pack)).not.toContain('Feed');
  });
});

describe('a focus session a pause overtakes', () => {
  const STORED = 'gozali.focus';
  const session = (packId: string, minutes: number | null = 25) =>
    JSON.stringify({ packId, minutes, startedAt: Date.now() - 60_000, pausedAt: null, pausedMs: 0, notificationId: 'the-end' });

  beforeEach(() => {
    phone({ pack: onPause(running(), { ...PACK, category: 'study' }) });
  });

  it('ends with the link at its end, which goes to the pack', async () => {
    await AsyncStorage.setItem(STORED, session(PACK.id));
    mockParams = { id: PACK.id, focus: '25' };
    await open(<FeedScreen />);
    await settle();

    expect(mockDismissTo).toHaveBeenCalledWith('/pack/gym');
    expect(await AsyncStorage.getItem(STORED)).toBeNull();
    expect(mockCancelled).toHaveBeenCalledWith('the-end');
  });

  it('runs on when the link to the camera is not the one at its end', async () => {
    const running = session(PACK.id);
    await AsyncStorage.setItem(STORED, running);
    await open(<FeedScreen />);
    await settle();

    expect(mockDismissTo).toHaveBeenCalledWith('/pack/gym');
    expect(await AsyncStorage.getItem(STORED)).toBe(running);
  });

  it('in another pack runs on, whichever old link was tapped here', async () => {
    const elsewhere = session('other');
    await AsyncStorage.setItem(STORED, elsewhere);
    mockParams = { id: PACK.id, focus: '25' };
    await open(<FeedScreen />);
    await settle();

    expect(await AsyncStorage.getItem(STORED)).toBe(elsewhere);
    expect(mockCancelled).not.toHaveBeenCalled();
  });

  it('keeps Focus on the pack, the only way back to an open timer', async () => {
    await AsyncStorage.setItem(STORED, session(PACK.id, null));
    const pack = await open(<PackScreen />);

    expect(buttons(pack)).toContain('Focus');
    expect(buttons(pack)).not.toContain('Feed');
  });

  it('takes Focus off the pack once it is over', async () => {
    await AsyncStorage.setItem(STORED, session(PACK.id, null));
    const pack = await open(<PackScreen />);

    await AsyncStorage.removeItem(STORED);
    await act(async () => mockOnFocus.forEach((run) => run()));
    await settle();

    expect(buttons(pack)).not.toContain('Focus');
  });

  it('leaves no Focus here when it runs in another pack', async () => {
    await AsyncStorage.setItem(STORED, session('other', null));

    expect(buttons(await open(<PackScreen />))).not.toContain('Focus');
  });
});
