import type { CritterArt } from '@gozali/critter-art';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import CritterProfileScreen from '@/app/(app)/pack/[id]/critter';
import type { PackCritter } from '@/features/packs/api';
import type { DayResultRow } from '@/features/social/api';

// The real profile screen and hooks over a stand-in for the server. The drawing of a critter comes
// out as text, so tests can read what a tile shows.
let mockRows: Record<string, unknown[]>;
/** Tables whose reads fail, as with no connection. */
const mockFailing = new Set<string>();
/** Holds every read until the test lets them through. */
let mockHeld: Promise<void>;
let mockCritter: PackCritter;
let mockMembers: unknown[];
/** What counted_feeds answers. */
let mockCounted: unknown[];
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      const read: Record<string, unknown> = {
        then: (done: (answer: unknown) => unknown, failed: (error: unknown) => unknown) =>
          mockHeld
            .then(() => (mockFailing.has(table) ? { data: null, error: new TypeError('Network request failed') } : { data: mockRows[table] ?? [], error: null }))
            .then(done, failed),
      };
      for (const step of ['select', 'eq', 'gte', 'lt', 'order']) read[step] = () => read;
      return read;
    },
    rpc: async (name: string) => ({ data: name === 'counted_feeds' ? mockCounted : [], error: null }),
  }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'pack' }), router: { push: jest.fn() } }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/features/critter/Critter', () => {
  const { renderCritter } = jest.requireActual('@gozali/critter-art');
  const { Text } = jest.requireActual('react-native');
  return { Critter: ({ art }: { art: CritterArt }) => <Text>{renderCritter(art)}</Text> };
});
jest.mock('@/features/feeds/queue', () => ({}));
jest.mock('@/features/feeds/send', () => ({}));
jest.mock('@/features/packs/api', () => ({
  packsKey: ['packs'],
  currentMembers: () => [],
  usePack: () => ({
    data: { id: 'pack', category: 'gym', timezone: 'UTC', pack_members: mockMembers, critters: mockCritter },
    isPending: false,
    isError: false,
  }),
}));
jest.mock('@/features/packs/realtime', () => ({ usePackRealtime: () => undefined }));
jest.mock('@/lib/confirm', () => ({ confirm: jest.fn(), notify: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/navigation', () => ({ goBack: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({}));

const SHOP = [
  { item: 'bow', slot: 'head', price: 10 },
  { item: 'bandana', slot: 'neck', price: 10 },
  { item: 'scarf', slot: 'neck', price: 10 },
  { item: 'cap', slot: 'head', price: 12 },
  { item: 'beanie', slot: 'head', price: 12 },
  { item: 'crown', slot: 'head', price: 45 },
];
const AWAY = 'The pet is not here right now.';
const LOAD_FAILED = "This didn't load. Check the connection and try again.";
const WARDROBE_EMPTY = 'Items from achievements and the shop show up here.';

let tree: ReactTestRenderer;

const pressable = (role: string, label: string) =>
  tree.root.findAll((node) => node.props.accessibilityRole === role && node.props.accessibilityLabel === label && typeof node.type === 'string');
const texts = () => tree.root.findAll((node) => node.type === 'Text').map((node) => [node.props.children].flat().join(''));
/** The drawing on each tile of the wardrobe, or of the shop. */
const drawings = (tiles: 'wardrobe' | 'shop') =>
  tree.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        (tiles === 'wardrobe'
          ? node.props.accessibilityRole === 'radio'
          : node.props.accessibilityRole === 'button' && /, [0-9]+ coins$/.test(node.props.accessibilityLabel ?? '')),
    )
    .map((tile) => tile.findAll((child) => child.type === 'Text')[0]?.props.children as string);

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

async function open() {
  await act(async () => {
    tree = create(
      // No garbage collection, whose timers would outlive the test.
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}>
        <CritterProfileScreen />
      </QueryClientProvider>,
    );
  });
  // An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
  await settle();
}

beforeEach(() => {
  mockCritter = { species: 'kit', name: 'Kit', health: 80, xp: 40, stage: 'kid', status: 'active', streak: 7, coins: 60, marks: [], outfit: {} };
  mockRows = { shop_items: SHOP };
  mockMembers = [];
  mockCounted = [];
  mockFailing.clear();
  mockHeld = Promise.resolve();
});

afterEach(async () => {
  await act(async () => tree.unmount());
});

describe('a pet that is away', () => {
  beforeEach(() => {
    mockCritter = { ...mockCritter, status: 'ran_away', health: 0 };
    mockRows.achievements = [{ key: 'hatched', unlocked_at: '2026-10-01T00:00:00Z' }];
    mockRows.pack_items = [{ item: 'cap' }];
  });

  it('draws each item for sale on the pet, not on the note it left', async () => {
    await open();

    const shop = drawings('shop');
    expect(shop).toHaveLength(4);
    expect(new Set(shop).size).toBe(4);
  });

  it('draws each item of the wardrobe on the pet too', async () => {
    await open();

    // None is the same drawing in each slot of a pet that wears nothing.
    const wardrobe = drawings('wardrobe');
    expect(wardrobe).toHaveLength(4);
    expect(new Set(wardrobe).size).toBe(3);
  });

  it('says why the wardrobe takes no taps', async () => {
    await open();

    expect(texts()).toContain(AWAY);
    expect(pressable('radio', 'cap')[0]?.props.accessibilityState).toEqual({ selected: false, disabled: true });
  });

  it('has nothing to say over an empty wardrobe', async () => {
    mockRows.achievements = [];
    mockRows.pack_items = [];
    await open();

    expect(texts()).not.toContain(AWAY);
  });
});

describe('a pet at home', () => {
  it('dresses with no word about being away', async () => {
    mockRows.achievements = [{ key: 'hatched', unlocked_at: '2026-10-01T00:00:00Z' }];
    await open();

    expect(texts()).not.toContain(AWAY);
    expect(pressable('radio', 'scarf')[0]?.props.accessibilityState).toEqual({ selected: false, disabled: false });
  });
});

describe('the reads behind the wardrobe, the shop and the achievements', () => {
  beforeEach(() => {
    mockRows.achievements = [{ key: 'hatched', unlocked_at: '2026-10-01T00:00:00Z' }];
    mockRows.pack_items = [{ item: 'cap' }];
  });

  it.each(['achievements', 'pack_items', 'shop_items'])('say so when %s did not load, and Try again brings them', async (table) => {
    mockFailing.add(table);
    await open();

    expect(texts()).toContain(LOAD_FAILED);
    expect(texts()).not.toContain('🔒');
    expect(texts()).not.toContain(WARDROBE_EMPTY);
    expect(pressable('button', 'scarf, 10 coins')).toHaveLength(0);
    expect(pressable('button', 'cap, 12 coins')).toHaveLength(0);

    mockFailing.clear();
    await act(async () => tree.root.findAll((node) => node.props.label === 'Try again' && node.props.onPress)[0]?.props.onPress());
    await settle();

    expect(texts()).not.toContain(LOAD_FAILED);
    expect(pressable('radio', 'scarf')).toHaveLength(1);
    expect(pressable('radio', 'cap')).toHaveLength(1);
    expect(pressable('button', 'bow, 10 coins')).toHaveLength(1);
    expect(texts()).toContain('🏆');
  });

  it('draw no locked list and no empty wardrobe while they are on their way', async () => {
    let release = () => {};
    mockHeld = new Promise((resolve) => {
      release = resolve;
    });
    await open();

    expect(texts()).not.toContain('🔒');
    expect(texts()).not.toContain(WARDROBE_EMPTY);
    expect(texts()).not.toContain(LOAD_FAILED);

    await act(async () => release());
    await settle();
    expect(pressable('radio', 'scarf')).toHaveLength(1);
  });

  it('leave an egg its achievements when only the shop did not load', async () => {
    mockCritter = { ...mockCritter, status: 'egg', stage: 'egg' };
    mockRows.achievements = [];
    mockFailing.add('shop_items');
    await open();

    expect(texts()).not.toContain(LOAD_FAILED);
    expect(texts()).toContain('🔒');
  });
});

describe('the wardrobe', () => {
  it('has one tile for an item bought before an achievement brought it too', async () => {
    mockRows.achievements = [{ key: 'streak_7', unlocked_at: '2026-10-20T00:00:00Z' }];
    mockRows.pack_items = [{ item: 'beanie' }, { item: 'cap' }];

    await open();

    expect(pressable('radio', 'beanie')).toHaveLength(1);
    expect(pressable('radio', 'cap')).toHaveLength(1);
  });
});

describe('the monthly board', () => {
  const member = (id: string, name: string, status: 'active' | 'left') => ({
    user_id: id,
    role: 'member',
    status,
    joined_at: '2026-10-01T00:00:00Z',
    profiles: { display_name: name },
  });
  const result = (day: string, ids: Partial<DayResultRow>): DayResultRow => ({
    day,
    result: 'success',
    fed_ids: [],
    rested_ids: [],
    joker_ids: [],
    paused_ids: [],
    sleeping_ids: [],
    missed_ids: [],
    ...ids,
  });
  const rows = () =>
    tree.root.findAll((node) => typeof node.type === 'string' && node.props.accessible === true && / fed, /.test(node.props.accessibilityLabel ?? ''));
  /** How a member's squares look, one per day of the month: they come after the name. */
  const squares = (name: string) =>
    rows()
      .find((row) => row.props.accessibilityLabel.startsWith(`${name}:`))!
      .children.slice(1)
      .map((square) => (typeof square === 'string' ? square : StyleSheet.flatten(square.props.style)));

  beforeEach(() => {
    // Today is November 4.
    jest.useFakeTimers({ now: new Date('2026-11-04T10:00:00Z'), advanceTimers: true });
    mockMembers = [member('dan', 'Dan', 'active'), member('eve', 'Eve', 'left'), member('maya', 'Maya', 'left')];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a row for a member who left after days of rest, a joker or a pause', async () => {
    mockRows.day_results = [
      result('2026-11-01', { fed_ids: ['dan'], rested_ids: ['eve'] }),
      result('2026-11-02', { fed_ids: ['dan'], joker_ids: ['eve'] }),
      result('2026-11-03', { fed_ids: ['dan'], paused_ids: ['eve'] }),
    ];
    await open();

    expect(rows().map((row) => row.props.accessibilityLabel)).toEqual([
      'Dan: 3 fed, 0 rest or joker, 0 paused or asleep, 0 missed',
      'Eve: 0 fed, 2 rest or joker, 1 paused or asleep, 0 missed',
    ]);
  });

  it('leaves today open only for members who can still feed', async () => {
    mockRows.day_results = [result('2026-11-03', { fed_ids: ['dan', 'eve', 'maya'] })];
    // Eve fed today before she left; the day's close won't count her.
    mockCounted = [{ pack_id: 'pack', user_id: 'eve', day: '2026-11-04' }];
    await open();

    // Nothing counted anyone on November 2, so its square is a plain one.
    const [dan, eve, maya] = ['Dan', 'Eve', 'Maya'].map(squares);
    expect(dan![3]).not.toEqual(dan![1]);
    expect(eve![3]).toEqual(eve![1]);
    expect(maya![3]).toEqual(maya![1]);
  });
});
