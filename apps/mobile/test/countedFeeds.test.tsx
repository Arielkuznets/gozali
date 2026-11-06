import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { fedToday, useCountedFeeds } from '@/features/feeds/api';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ rpc: (...args: unknown[]) => mockRpc(...args), from: (...args: unknown[]) => mockFrom(...args) }),
}));
jest.mock('@/features/feeds/queue', () => ({}));
jest.mock('@/features/feeds/send', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({}));

const dan = { pack_id: 'pack', user_id: 'dan', day: '2026-11-01' };
const noFunction = { code: 'PGRST202', message: 'Could not find the function public.counted_feeds without parameters' };
const refused = { code: 'PGRST301', message: 'No suitable key or wrong key type' };

/** The table read: each step of the query hands back the same builder, the last one the answer. */
function tableAnswers(answer: unknown) {
  const read = { select: jest.fn(() => read), eq: jest.fn(() => read), gte: jest.fn(async () => answer) };
  mockFrom.mockReturnValue(read);
  return read;
}

async function counted() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let query: UseQueryResult<unknown> | undefined;
  function Reader() {
    query = useCountedFeeds();
    return null;
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <Reader />
      </QueryClientProvider>,
    );
  });
  while (query!.isFetching) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });
  }
  await act(async () => tree.unmount());
  client.clear();
  return query!;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

describe('who fed', () => {
  it('comes from the server function, without touching the table', async () => {
    mockRpc.mockResolvedValue({ data: [dan], error: null });

    expect((await counted()).data).toEqual([dan]);
    expect(mockRpc).toHaveBeenCalledWith('counted_feeds');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("comes from the table on a server that doesn't have the function yet", async () => {
    mockRpc.mockResolvedValue({ data: null, error: noFunction });
    const read = tableAnswers({ data: [dan], error: null });

    expect((await counted()).data).toEqual([dan]);
    expect(mockFrom).toHaveBeenCalledWith('feeds');
    expect(read.select).toHaveBeenCalledWith('pack_id, user_id, day');
    expect(read.eq).toHaveBeenCalledWith('is_extra', false);
    expect(read.gte).toHaveBeenCalledWith('day', expect.any(String));
  });

  it('is an error when the table refuses too', async () => {
    mockRpc.mockResolvedValue({ data: null, error: noFunction });
    tableAnswers({ data: null, error: refused });

    expect((await counted()).error).toBe(refused);
  });

  it('is an error when the server refuses, not a read of what a block hides', async () => {
    mockRpc.mockResolvedValue({ data: null, error: refused });

    expect((await counted()).error).toBe(refused);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('fedToday', () => {
  const pack = { id: 'pack', timezone: 'Asia/Jerusalem' };
  const lateAtNight = new Date('2026-11-01T20:00:00Z');

  it("says who fed on the pack's day", () => {
    expect(fedToday([dan], pack, lateAtNight)).toEqual(new Set(['dan']));
  });

  it("says nobody on a new day, so a copy kept on the phone can't speak for today", () => {
    const nextMorning = new Date('2026-11-02T08:00:00Z');
    expect(fedToday([dan], pack, nextMorning)).toEqual(new Set());
  });
});
