import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { packFeedsKey, type FeedItem } from '@/features/feeds/api';
import { useReact, type ReactionTotal } from '@/features/social/api';

jest.mock('@/features/feeds/queue', () => ({}));
jest.mock('@/features/feeds/send', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({}));

const mockAnswers: ((answer: { data: null; error: { message: string } | null }) => void)[] = [];
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    rpc: (name: string) =>
      name === 'react'
        ? new Promise((resolve) => {
            mockAnswers.push(resolve);
          })
        : Promise.resolve({ data: null, error: { message: 'Network request failed' } }),
  }),
}));

const REFUSED = { data: null, error: { message: 'feed_not_found' } };
const SAVED = { data: null, error: null };

const PAGE = [...packFeedsKey, 'pack', 30];
const LONGER_PAGE = [...packFeedsKey, 'pack', 60];
const FROM_DAN: ReactionTotal = { emoji: 'clap', total: 1, mine: false, names: ['Dan'] };
const MINE: ReactionTotal = { emoji: 'fire', total: 1, mine: true, names: [] };

const photo = (id: string, reactions: ReactionTotal[] = []) => ({ id, reactions }) as FeedItem;

let client: QueryClient;
let tree: ReactTestRenderer;
let react: ReturnType<typeof useReact>;

function Screen() {
  const current = useReact();
  useEffect(() => {
    react = current;
  });
  return null;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const tap = async (feedId: string) => {
  await act(async () => react.mutate({ feedId, emoji: 'fire' }));
  await settle();
};
const answer = async (index: number, result: typeof REFUSED | typeof SAVED) => {
  await act(async () => mockAnswers[index]?.(result));
  await settle();
};

beforeEach(async () => {
  mockAnswers.length = 0;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } } });
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <Screen />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => tree.unmount());
  client.clear();
});

describe('a reaction that fails', () => {
  it('goes back on its own photo, on every page as it stands by then', async () => {
    client.setQueryData(PAGE, [photo('a', [FROM_DAN])]);
    client.setQueryData(LONGER_PAGE, [photo('a', [FROM_DAN]), photo('older')]);
    await tap('a');

    // A reload lands while the request is on its way.
    client.setQueryData(PAGE, [photo('new'), photo('a', [FROM_DAN, MINE])]);
    await answer(0, REFUSED);

    expect(client.getQueryData(PAGE)).toEqual([photo('new'), photo('a', [FROM_DAN])]);
    expect(client.getQueryData(LONGER_PAGE)).toEqual([photo('a', [FROM_DAN]), photo('older')]);
  });

  it('leaves a reaction on another photo that was saved in the meantime', async () => {
    client.setQueryData(PAGE, [photo('a'), photo('b')]);
    await tap('a');
    await tap('b');
    await answer(1, SAVED);

    await answer(0, REFUSED);

    expect(client.getQueryData(PAGE)).toEqual([photo('a'), photo('b', [MINE])]);
  });
});
