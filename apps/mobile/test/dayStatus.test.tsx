import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import { useDayStatus, useMembersToday } from '@/features/days/api';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }) }));
jest.mock('@/features/packs/api', () => ({ usePack: () => ({ data: { timezone: 'UTC' } }) }));

function Status() {
  useDayStatus('pack');
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRpc.mockReset().mockResolvedValue({ data: { pass: null }, error: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("a member's status for today", () => {
  it('is asked for again when 03:00 passes with the screen open', async () => {
    jest.setSystemTime(new Date('2026-10-29T02:58:00Z'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Status />
        </QueryClientProvider>,
      );
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);

    // 02:59 is still yesterday's pack day; 03:00 starts a new one.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it("asks again when the first answer after 03:00 is still yesterday's", async () => {
    jest.setSystemTime(new Date('2026-10-29T03:00:10Z'));
    mockRpc
      .mockResolvedValueOnce({ data: { day: '2026-10-28', passToday: 'rest' }, error: null })
      .mockResolvedValue({ data: { day: '2026-10-29', passToday: null }, error: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Status />
        </QueryClientProvider>,
      );
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    client.clear();
  });
});

describe('what the hatch steps know of the members', () => {
  function Members() {
    useMembersToday({ id: 'pack', timezone: 'UTC' }, new Date(), true);
    return null;
  }

  const open = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Members />
        </QueryClientProvider>,
      );
    });
    return client;
  };
  const after = (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });
  const answer = (day: string, dayToClose: unknown) => ({
    data: { day, restDaysPerWeek: 0, members: [], dayToClose },
    error: null,
  });

  it('is asked for again until the day before has closed', async () => {
    jest.setSystemTime(new Date('2026-10-29T03:09:00Z'));
    mockRpc
      .mockResolvedValueOnce(answer('2026-10-29', { day: '2026-10-28' }))
      .mockResolvedValueOnce(answer('2026-10-29', { day: '2026-10-28' }))
      .mockResolvedValue(answer('2026-10-29', null));
    const client = await open();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await after(15_000);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    await after(15_000);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    await after(60_000);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    client.clear();
  });

  it("is asked for again when the first answer after 03:00 is still yesterday's", async () => {
    jest.setSystemTime(new Date('2026-10-29T03:00:10Z'));
    mockRpc.mockResolvedValueOnce(answer('2026-10-28', null)).mockResolvedValue(answer('2026-10-29', null));
    const client = await open();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await after(15_000);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    await after(60_000);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    client.clear();
  });

  it('is asked for once on a server that says nothing of the day before', async () => {
    jest.setSystemTime(new Date('2026-10-29T03:09:00Z'));
    mockRpc.mockResolvedValue({ data: { restDaysPerWeek: 0, members: [] }, error: null });
    const client = await open();
    await after(60_000);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
