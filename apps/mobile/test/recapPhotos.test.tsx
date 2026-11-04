import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import RecapScreen from '@/app/(app)/pack/[id]/recap';
import { StoryCard } from '@/features/recap/StoryCard';

// The real recap screen and hooks over a stand-in for the server. mockVisible is what the row level
// security of feeds lets through: a photo hidden by reports stops coming back.
let mockVisible: string[];
let mockPoster: string;
let mockReads = 0;
let mockReadFails = false;
let mockLinksFail = false;
let mockHeld: Promise<void> = Promise.resolve();

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
    topMembers: [] as string[],
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
          await mockHeld;
          mockReads += 1;
          if (mockReadFails) return { data: null, error: new Error('offline') };
          return { data: mockVisible.map((id) => ({ id, user_id: mockPoster, photo_path: `${table}/${id}.jpg` })), error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) =>
          mockLinksFail
            ? { data: null, error: new Error('storage is down') }
            : { data: paths.map((path) => ({ path, signedUrl: `https://photos.test/${path}?read=${mockReads}` })), error: null },
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
let mockMembers: { user_id: string; profiles: { display_name: string } }[];
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({
    data: { id: 'pack', name: 'Pack', category: 'gym', pack_members: mockMembers },
    isPending: false,
    isError: false,
    refetch: async () => undefined,
  }),
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
const SHARE = 'Share as a story';
const LOAD_FAILED = "This didn't load. Check the connection and try again.";
const button = (label: string) => tree!.root.findAll((node) => node.props.label === label && node.props.onPress)[0];
/** Share can't be pressed yet, whether it waits with a spinner or is greyed out. */
const held = () => Boolean(button(SHARE)?.props.disabled || button(SHARE)?.props.loading);
const says = (text: string) => tree!.root.findAll((node) => node.type === 'Text' && [node.props.children].flat().join() === text).length > 0;
const link = (id: string, read: number) => `https://photos.test/feeds/${id}.jpg?read=${read}`;
// What expo-image calls once a picture is in, or once it couldn't load.
const loads = (photo: ReactTestInstance) =>
  act(async () => {
    photo.props.onLoad?.({ cacheType: 'disk' });
    photo.props.onLoadEnd?.();
  });
const fails = (photo: ReactTestInstance) =>
  act(async () => {
    photo.props.onError?.({ error: 'gone' });
    photo.props.onLoadEnd?.();
  });

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
  mockRecap.stats.topMembers = [];
  mockRecap.stats.topFeeds = 0;
  mockMembers = [];
  mockVisible = ['a', 'b'];
  mockPoster = 'dan';
  mockReads = 0;
  mockReadFails = false;
  mockLinksFail = false;
  mockHeld = Promise.resolve();
  // No garbage collection, whose timers would outlive the test.
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
});

afterEach(async () => {
  await close();
  jest.useRealTimers();
});

describe('a collage that does not load', () => {
  it.each([
    ['the read of the feeds', () => (mockReadFails = true)],
    ['the links', () => (mockLinksFail = true)],
  ])('says so when %s fail, and Try again brings the photos', async (_name, fail) => {
    fail();
    await open();
    expect(shown()).toEqual([]);
    expect(says(LOAD_FAILED)).toBe(true);

    mockReadFails = false;
    mockLinksFail = false;
    await act(async () => button('Try again')?.props.onPress());
    await settle();

    expect(shown()).toEqual(['a', 'b']);
    expect(says(LOAD_FAILED)).toBe(false);
  });

  it('says nothing of a collage with no photos left', async () => {
    mockVisible = [];
    await open();

    expect(says(LOAD_FAILED)).toBe(false);
    expect(button(SHARE)?.props.disabled).toBe(false);
  });

  it('holds Share while the photos are on their way, for a story that has them', async () => {
    let release = () => {};
    mockHeld = new Promise((resolve) => {
      release = resolve;
    });
    await open();
    expect(held()).toBe(true);

    await act(async () => release());
    await settle();

    expect(held()).toBe(false);
  });

  it('holds Share while the collage has failed', async () => {
    mockReadFails = true;
    await open();

    expect(button(SHARE)?.props.disabled).toBe(true);
  });
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

describe('the most consistent members', () => {
  const NOA = { user_id: 'noa', profiles: { display_name: 'Noa' } };
  const mostConsistent = () =>
    tree!.root
      .findAll((node) => node.type === 'Text')
      .map((node) => [node.props.children].flat().join(''))
      .filter((text) => text.startsWith('Most consistent'));

  // A deleted account takes its member row along, and its id stays in the recap.
  it('are only those still in the pack', async () => {
    mockRecap.stats.topMembers = ['gone', 'noa'];
    mockRecap.stats.topFeeds = 6;
    mockMembers = [NOA];
    await open();

    expect(mostConsistent()).toEqual(['Most consistent: Noa, 6 feeds']);
  });

  it('have no line when none of them is left', async () => {
    mockRecap.stats.topMembers = ['gone'];
    mockRecap.stats.topFeeds = 5;
    mockMembers = [NOA];
    await open();

    expect(mostConsistent()).toEqual([]);
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

  it('holds Share until each of its photos has loaded or failed', async () => {
    mockPoster = 'noa';
    await open();
    expect(storyPhotos()).toHaveLength(2);
    expect(button(SHARE)?.props.loading).toBe(true);

    await loads(storyPhotos()[0]!);
    expect(button(SHARE)?.props.loading).toBe(true);

    await fails(storyPhotos()[1]!);
    expect(held()).toBe(false);
  });

  it('waits only for the photos it holds', async () => {
    mockPoster = 'noa';
    mockVisible = ['a', 'b', 'c', 'd'];
    await open();
    expect(storyPhotos()).toHaveLength(3);

    for (const photo of storyPhotos()) await loads(photo);

    expect(held()).toBe(false);
  });

  it('lets Share go after a few seconds when a photo never answers', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockPoster = 'noa';
    await open();
    expect(held()).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });

    expect(held()).toBe(false);
  });
});
