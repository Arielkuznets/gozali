import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert, Modal, Platform } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import type { FeedItem } from '@/features/feeds/api';
import { FeedList } from '@/features/feeds/FeedList';

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const chain = { duration: () => chain, easing: () => chain };
  return { __esModule: true, default: { View }, Easing: { out: () => undefined }, SlideInDown: chain };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));

let mockAnswer: (answer: { error: Error | null }) => void;
const mockSaved = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: (table: string) => ({
      upsert: (row: unknown) => {
        mockSaved(table, row);
        return new Promise((resolve) => {
          mockAnswer = resolve;
        });
      },
    }),
  }),
}));

// The first drawing loads everything the list imports.
jest.setTimeout(15_000);

const feed = (id: string, user: string, minute: number): FeedItem => ({
  id,
  pack_id: 'pack',
  user_id: user,
  photo_path: `pack/${user}/${id}.jpg`,
  caption: null,
  day: '2026-11-01',
  is_extra: false,
  focus_minutes: null,
  created_at: `2026-11-01T10:0${minute}:00Z`,
  photoUrl: `https://photo/${id}`,
  reactions: [],
});
const FEEDS = [feed('from-dan', 'dan', 1), feed('from-yael', 'yael', 2)];
const NAMES = new Map([
  ['dan', 'Dan'],
  ['yael', 'Yael'],
]);

let tree: ReactTestRenderer;
let client: QueryClient;

// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const openModals = () => tree.root.findAllByType(Modal).filter((modal) => modal.props.visible);
const textOf = (node: ReactTestInstance) => node.findAll((child) => child.type === 'Text').flatMap((child) => child.props.children);
const menuRows = () => tree.root.findAll((node) => node.props.accessibilityRole === 'menuitem' && typeof node.props.onPress === 'function');
const viewerMore = () =>
  openModals()[0]?.findAll((node) => node.props.accessibilityLabel === 'More' && typeof node.props.onPress === 'function') ?? [];

/** Newest first, so Yael's photo is the first tile. */
async function openPhoto(index: number) {
  const tiles = tree.root.findAll((node) => node.props.accessibilityRole === 'imagebutton' && typeof node.props.onPress === 'function');
  await act(async () => tiles[index]?.props.onPress());
}

async function confirmBlock() {
  const alert = jest.mocked(Alert.alert);
  await openPhoto(1);
  await act(async () => viewerMore()[0]?.props.onPress());
  await act(async () => menuRows().find((row) => textOf(row).includes('Block Dan'))?.props.onPress());
  await act(async () => alert.mock.lastCall?.[2]?.find((button) => button.style === 'destructive')?.onPress?.());
  await settle();
  expect(mockSaved).toHaveBeenCalledWith('blocks', { blocker_id: 'noa', blocked_id: 'dan' });
}

describe('a block from a photo on the whole screen', () => {
  let platform: jest.ReplaceProperty<typeof Platform.OS>;

  beforeEach(async () => {
    // iOS runs a menu's choice when the native sheet is gone, and nothing here draws one.
    platform = jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockSaved.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
    await act(async () => {
      tree = create(
        <QueryClientProvider client={client}>
          <FeedList
            feeds={FEEDS}
            events={[]}
            names={NAMES}
            critterName="Pico"
            emoji="🏋️"
            today="Sun Nov 01 2026"
            someoneFed
            userId="noa"
            onReact={() => undefined}
            onMore={() => undefined}
          />
        </QueryClientProvider>,
      );
    });
  });

  // TanStack keeps rescheduling the clean-up of a mutation still pending, and Jest would wait on it.
  afterEach(async () => {
    await act(async () => mockAnswer({ error: null }));
    await settle();
    await act(async () => tree.unmount());
    client.clear();
    platform.restore();
    jest.restoreAllMocks();
  });

  // The viewer closes when the block lands. A menu open over it then would stay behind on Android,
  // and on iOS would hold the viewer up with nothing in it.
  it('takes the menu away until the answer comes', async () => {
    await confirmBlock();

    expect(viewerMore().length).toBe(0);
  });

  it('closes the viewer on the answer and opens the next photo with no menu', async () => {
    await confirmBlock();
    await act(async () => viewerMore()[0]?.props.onPress());
    await act(async () => mockAnswer({ error: null }));
    await settle();

    expect(openModals().length).toBe(0);
    expect(jest.mocked(Alert.alert).mock.lastCall?.[0]).toBe('Blocked. You can also leave this pack from its settings.');

    await openPhoto(0);

    expect(openModals().length).toBe(1);
    expect(textOf(openModals()[0]!)).toContain('Yael');
    expect(menuRows().length).toBe(0);
  });

  it('gives the menu back after a refusal, with the photo still open', async () => {
    await confirmBlock();
    await act(async () => mockAnswer({ error: new TypeError('Network request failed') }));
    await settle();

    expect(openModals().length).toBe(1);
    expect(viewerMore().length).toBeGreaterThan(0);
  });
});
