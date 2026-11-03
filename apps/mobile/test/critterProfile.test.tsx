import type { CritterArt } from '@gozali/critter-art';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import CritterProfileScreen from '@/app/(app)/pack/[id]/critter';
import type { PackCritter } from '@/features/packs/api';

// The real profile screen and hooks over a stand-in for the server. The drawing of a critter comes
// out as text, so tests can read what a tile shows.
let mockRows: Record<string, unknown[]>;
let mockCritter: PackCritter;
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      const read: Record<string, unknown> = {
        then: (done: (answer: unknown) => unknown, failed: (error: unknown) => unknown) =>
          Promise.resolve({ data: mockRows[table] ?? [], error: null }).then(done, failed),
      };
      for (const step of ['select', 'eq', 'gte', 'lt', 'order']) read[step] = () => read;
      return read;
    },
    rpc: async () => ({ data: [], error: null }),
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
  usePack: () => ({ data: { id: 'pack', category: 'gym', timezone: 'UTC', pack_members: [], critters: mockCritter }, isPending: false, isError: false }),
}));
jest.mock('@/features/packs/realtime', () => ({ usePackRealtime: () => undefined }));
jest.mock('@/features/social/MonthlyBoard', () => ({ MonthlyBoard: () => null }));
jest.mock('@/lib/confirm', () => ({ confirm: jest.fn(), notify: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/navigation', () => ({ goBack: jest.fn() }));
jest.mock('@react-native-community/netinfo', () => ({}));

const SHOP = [
  { item: 'bow', slot: 'head', price: 10 },
  { item: 'bandana', slot: 'neck', price: 10 },
  { item: 'cap', slot: 'head', price: 12 },
  { item: 'beanie', slot: 'head', price: 12 },
  { item: 'crown', slot: 'head', price: 45 },
];
const AWAY = 'The pet is not here right now.';

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
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

beforeEach(() => {
  mockCritter = { species: 'kit', name: 'Kit', health: 80, xp: 40, stage: 'kid', status: 'active', streak: 7, coins: 60, marks: [], outfit: {} };
  mockRows = { shop_items: SHOP };
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

describe('the wardrobe', () => {
  it('has one tile for an item bought before an achievement brought it too', async () => {
    mockRows.achievements = [{ key: 'streak_7', unlocked_at: '2026-10-20T00:00:00Z' }];
    mockRows.pack_items = [{ item: 'beanie' }, { item: 'cap' }];

    await open();

    expect(pressable('radio', 'beanie')).toHaveLength(1);
    expect(pressable('radio', 'cap')).toHaveLength(1);
  });
});
