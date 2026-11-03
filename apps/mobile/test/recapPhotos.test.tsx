import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import RecapScreen from '@/app/(app)/pack/[id]/recap';
import { StoryCard } from '@/features/recap/StoryCard';

// The real recap screen and hooks over a stand-in for the server. mockVisible is what the row level
// security of feeds lets through: a photo hidden by reports stops coming back.
let mockVisible: string[];
let mockPoster: string;
let mockReads = 0;

const mockRecap = {
  week_start: '2026-10-18',
  feed_ids: ['a', 'b'],
  stats: {
    weekStart: '2026-10-18',
    weekEnd: '2026-10-24',
    days: 7,
    successDays: 6,
    healthStart: 70,
    healthEnd: 85,
    topMembers: [],
    topFeeds: 0,
    achievements: [],
    critter: { species: 'axo', stage: 'kid', status: 'active', health: 85, marks: [], outfit: {}, name: 'Pico', streak: 7 },
  },
};

jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: [mockRecap], error: null }) }) }),
        in: async () => {
          mockReads += 1;
          return { data: mockVisible.map((id) => ({ id, user_id: mockPoster, photo_path: `${table}/${id}.jpg` })), error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `https://photos.test/${path}?read=${mockReads}` })), error: null }),
      }),
    },
  }),
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'pack' }) }));
jest.mock('expo-sharing', () => ({}));
jest.mock('react-native-view-shot', () => ({}));
jest.mock('react-native-svg', () => ({ SvgXml: () => null }));
jest.mock('@gozali/critter-art', () => ({ critterArtFor: () => ({}), renderCritter: () => '' }));
jest.mock('@/components/Screen', () => ({ Screen: ({ children }: { children: ReactNode }) => children }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/feeds/PhotoViewer', () => ({ PhotoViewer: () => null }));
jest.mock('@/features/feeds/send', () => ({ PHOTO_BUCKET: 'photos' }));
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({ data: { id: 'pack', name: 'Pack', category: 'gym', pack_members: [] }, isPending: false, isError: false, refetch: async () => undefined }),
}));
jest.mock('@/lib/confirm', () => ({ notify: () => undefined }));
jest.mock('@/lib/navigation', () => ({ goBack: () => undefined }));

let client: QueryClient;
let tree: ReactTestRenderer | undefined;

// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const tiles = () => tree!.root.findAllByType(Image);
const shown = () => tiles().map((tile) => tile.props.source.cacheKey);
const storyPhotos = () => tree!.root.findByType(StoryCard).findAllByType(Image);
const link = (id: string, read: number) => `https://photos.test/feeds/${id}.jpg?read=${read}`;

async function open() {
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <RecapScreen />
      </QueryClientProvider>,
    );
  });
  // The photos are asked for once the recap is in.
  await settle();
  await settle();
}

async function close() {
  await act(async () => tree?.unmount());
  tree = undefined;
}

beforeEach(() => {
  mockVisible = ['a', 'b'];
  mockPoster = 'dan';
  mockReads = 0;
  // No garbage collection, whose timers would outlive the test.
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
});

afterEach(async () => {
  await close();
});

describe('the collage of a recap', () => {
  it('loses a photo hidden since it was last opened', async () => {
    await open();
    expect(shown()).toEqual(['a', 'b']);

    await close();
    mockVisible = ['b'];
    await open();

    expect(shown()).toEqual(['b']);
  });

  it('keeps a loaded photo on its link when a read brings a new one, and a photo still loading takes it', async () => {
    await open();
    await act(async () => tiles()[0]?.props.onLoad?.({ cacheType: 'disk' }));

    await act(async () => {
      await client.invalidateQueries();
    });
    await settle();

    expect(mockReads).toBe(2);
    expect(tiles().map((tile) => tile.props.source.uri)).toEqual([link('a', 1), link('b', 2)]);
  });
});

describe('the story image', () => {
  it('keeps a loaded photo on its link when a read brings a new one, and a photo still loading takes it', async () => {
    mockPoster = 'noa';
    await open();
    await act(async () => storyPhotos()[0]?.props.onLoad?.({ cacheType: 'disk' }));

    await act(async () => {
      await client.invalidateQueries();
    });
    await settle();

    expect(mockReads).toBe(2);
    expect(storyPhotos().map((photo) => photo.props.source.uri)).toEqual([link('a', 1), link('b', 2)]);
  });
});
