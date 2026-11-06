import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { FEED_PAGE, usePackFeed } from '@/features/feeds/api';

// The real hook over a stand-in for the server, whose answers the tests can hold back: the two
// calls after the list can come back in either order.
type Row = { id: string; photo_path: string | null };
let mockRows: Row[];
const mockReactions = jest.fn();
const mockSign = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    rpc: (_name: string, args: unknown) => mockReactions(args),
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: mockRows, error: null }) }) }) }) }),
    storage: { from: () => ({ createSignedUrls: (paths: string[]) => mockSign(paths) }) },
  }),
}));
jest.mock('@/features/feeds/queue', () => ({}));
jest.mock('@/features/feeds/send', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({}));

const photo = (id: string): Row => ({ id, photo_path: `pack/${id}.jpg` });
const noPhoto = (id: string): Row => ({ id, photo_path: null });
const link = (path: string) => `https://photos.test/${path}`;
const linksFor = (paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: link(path) })), error: null });
const NO_REACTIONS = { data: [], error: null };
const FIRE = { emoji: 'fire', total: 2, mine: true, names: ['Dan'] };
const REFUSED = { message: 'refused' };

/** An answer the test lets out when it wants to. */
function held<T>() {
  let release = (_: T) => {};
  const answer = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

const trees: ReactTestRenderer[] = [];

async function open(limit?: number, retry: number | false = false) {
  const screen = {} as Pick<ReturnType<typeof usePackFeed>, 'data' | 'error' | 'isError' | 'isFetching' | 'refetch'>;
  function Pack() {
    const { data, error, isError, isFetching, refetch } = usePackFeed('pack', limit);
    Object.assign(screen, { data, error, isError, isFetching, refetch });
    return null;
  }
  // No garbage collection, whose timers would outlive the test.
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry, retryDelay: 0 } } });
  await act(async () => {
    trees.push(
      create(
        <QueryClientProvider client={client}>
          <Pack />
        </QueryClientProvider>,
      ),
    );
  });
  await settle();
  return screen;
}

beforeEach(() => {
  mockRows = [photo('a'), noPhoto('b'), photo('c')];
  mockReactions.mockReset();
  mockSign.mockReset();
  mockReactions.mockResolvedValue(NO_REACTIONS);
  mockSign.mockImplementation(async (paths: string[]) => linksFor(paths));
});

afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
});

describe('the pack feed', () => {
  it('asks for the reactions and the photo links together', async () => {
    const reactions = held<typeof NO_REACTIONS>();
    mockReactions.mockReturnValue(reactions.answer);

    const screen = await open();

    expect(mockReactions).toHaveBeenCalledTimes(1);
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(screen.data).toBeUndefined();

    await act(async () => reactions.release(NO_REACTIONS));
    await settle();
    expect(screen.data).toHaveLength(3);
  });

  it('waits for both, and puts each on the right photo when the links come last', async () => {
    const links = held<ReturnType<typeof linksFor>>();
    mockReactions.mockResolvedValue({ data: [{ feed_id: 'b', ...FIRE }], error: null });
    mockSign.mockReturnValue(links.answer);

    const screen = await open();
    expect(screen.data).toBeUndefined();

    await act(async () => links.release(linksFor(['pack/a.jpg', 'pack/c.jpg'])));
    await settle();

    expect(screen.data?.map((feed) => feed.photoUrl)).toEqual([link('pack/a.jpg'), null, link('pack/c.jpg')]);
    expect(screen.data?.map((feed) => feed.reactions)).toEqual([[], [FIRE], []]);
  });

  it('waits for both, and puts each on the right photo when the reactions come last', async () => {
    const reactions = held<unknown>();
    mockReactions.mockReturnValue(reactions.answer);

    const screen = await open();
    expect(screen.data).toBeUndefined();

    await act(async () => reactions.release({ data: [{ feed_id: 'c', ...FIRE }], error: null }));
    await settle();

    expect(screen.data?.map((feed) => feed.photoUrl)).toEqual([link('pack/a.jpg'), null, link('pack/c.jpg')]);
    expect(screen.data?.map((feed) => feed.reactions)).toEqual([[], [], [FIRE]]);
  });

  it('signs nothing for a page without photos', async () => {
    mockRows = [noPhoto('a')];

    const screen = await open();

    expect(mockSign).not.toHaveBeenCalled();
    expect(mockReactions).toHaveBeenCalledTimes(1);
    expect(screen.data?.[0]?.photoUrl).toBeNull();
  });

  it('asks for nothing more on a pack with no feeds', async () => {
    mockRows = [];

    const screen = await open();

    expect(mockReactions).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
    expect(screen.data).toEqual([]);
  });

  it('keeps what the database answered when a first read gets no links, and says the read failed', async () => {
    mockReactions.mockResolvedValue({ data: [{ feed_id: 'c', ...FIRE }], error: null });
    mockSign.mockResolvedValue({ data: null, error: REFUSED });

    const screen = await open();

    expect(screen.data?.map((feed) => feed.id)).toEqual(['a', 'b', 'c']);
    expect(screen.data?.map((feed) => feed.photoUrl)).toEqual([null, null, null]);
    expect(screen.data?.map((feed) => feed.reactions)).toEqual([[], [], [FIRE]]);
    expect(screen.error).toBe(REFUSED);
  });

  it('fills the photos in when a retry of that read gets its links', async () => {
    mockSign.mockResolvedValueOnce({ data: null, error: REFUSED });

    const screen = await open(undefined, 1);
    await settle();

    expect(mockSign).toHaveBeenCalledTimes(2);
    expect(screen.data?.map((feed) => feed.photoUrl)).toEqual([link('pack/a.jpg'), null, link('pack/c.jpg')]);
    expect(screen.isError).toBe(false);
  });

  it('fills the photos in on the next read after that read failed for good', async () => {
    mockSign.mockResolvedValueOnce({ data: null, error: REFUSED });
    const screen = await open();

    await act(async () => {
      await screen.refetch();
    });
    await settle();

    expect(screen.data?.map((feed) => feed.photoUrl)).toEqual([link('pack/a.jpg'), null, link('pack/c.jpg')]);
    expect(screen.isError).toBe(false);
  });

  it('keeps the photos it has when a later read gets no links', async () => {
    const screen = await open();
    mockRows = [photo('d'), ...mockRows];
    mockSign.mockResolvedValue({ data: null, error: REFUSED });

    await act(async () => {
      await screen.refetch();
    });
    await settle();

    expect(screen.data?.map((feed) => feed.photoUrl)).toEqual([link('pack/a.jpg'), null, link('pack/c.jpg')]);
    expect(screen.isError).toBe(true);
  });

  it('fails a longer page that gets no links: the page before it has the photos', async () => {
    mockSign.mockResolvedValue({ data: null, error: REFUSED });

    const screen = await open(FEED_PAGE * 2);

    expect(screen.data).toBeUndefined();
    expect(screen.error).toBe(REFUSED);
  });

  it('fails when the reactions are refused, and links that come later change nothing', async () => {
    const links = held<ReturnType<typeof linksFor>>();
    mockReactions.mockResolvedValue({ data: null, error: REFUSED });
    mockSign.mockReturnValue(links.answer);

    const screen = await open();
    expect(screen.error).toBe(REFUSED);

    await act(async () => links.release(linksFor(['pack/a.jpg', 'pack/c.jpg'])));
    await settle();

    expect(screen.isError).toBe(true);
    expect(screen.data).toBeUndefined();
  });

  // Jest fails a test on a rejection nobody handles, so this also covers the second of the two.
  it('fails when neither call gets through', async () => {
    mockReactions.mockRejectedValue(new TypeError('Network request failed'));
    mockSign.mockRejectedValue(new TypeError('Network request failed'));

    const screen = await open();

    expect(screen.isError).toBe(true);
  });

  it('keeps the list on screen while it is read again', async () => {
    const screen = await open();
    expect(screen.data).toHaveLength(3);
    const reactions = held<typeof NO_REACTIONS>();
    mockReactions.mockReturnValue(reactions.answer);

    await act(async () => {
      void screen.refetch();
    });
    await settle();
    expect(screen.isFetching).toBe(true);
    expect(screen.data).toHaveLength(3);

    await act(async () => reactions.release(NO_REACTIONS));
    await settle();
  });
});
