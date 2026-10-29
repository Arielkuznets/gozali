import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import { useDayStatus } from '@/features/days/api';

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
});
