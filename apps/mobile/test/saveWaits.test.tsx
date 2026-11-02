import { QueryClient, QueryClientProvider, QueryObserver, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { daysKey, useCancelDayPass, useDayPass, useEndPause, useStartPause } from '@/features/days/api';
import { feedsKey, packFeedsKey, useSendFeed } from '@/features/feeds/api';
import type { OutgoingFeed } from '@/features/feeds/send';
import { useBlock, useReact } from '@/features/social/api';

// Saves against reads that keep failing or never answer: what a save tells the member can't wait
// for them. The read stands in for whatever is mounted under the screen; retries are the defaults.
const mockRead = jest.fn();
const mockSave = jest.fn();

jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn(), addEventListener: () => () => undefined }));
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  storedSession: async () => null,
  requireSupabase: () => ({
    rpc: () => mockSave(),
    from: () => ({ upsert: () => mockSave() }),
  }),
}));
const mockSendFeed = jest.fn();
jest.mock('@/features/feeds/send', () => ({
  ...jest.requireActual('@/features/feeds/send'),
  sendFeed: (feed: unknown) => mockSendFeed(feed),
}));
const mockOnline = jest.fn();
jest.mock('@/features/feeds/queue', () => ({
  ...jest.requireActual('@/features/feeds/queue'),
  enqueue: async () => true,
  isOnline: () => mockOnline(),
}));

const feed: OutgoingFeed = {
  id: 'a',
  packId: 'pack',
  userId: 'noa',
  photoUri: 'cache/a.jpg',
  caption: null,
  capturedAt: '2026-11-01T10:00:00Z',
  focusMinutes: null,
  extra: false,
};

const failed = { data: null, error: { message: 'TypeError: Network request failed', code: '' } };

let hooks: {
  send: ReturnType<typeof useSendFeed>;
  rest: ReturnType<typeof useDayPass>;
  undo: ReturnType<typeof useCancelDayPass>;
  startPause: ReturnType<typeof useStartPause>;
  endPause: ReturnType<typeof useEndPause>;
  react: ReturnType<typeof useReact>;
  block: ReturnType<typeof useBlock>;
};

function Screen() {
  useQuery({ queryKey: [...feedsKey, 'read'], queryFn: mockRead });
  useQuery({ queryKey: [...daysKey, 'read'], queryFn: mockRead });
  const current = {
    send: useSendFeed(),
    rest: useDayPass('pack'),
    undo: useCancelDayPass('pack'),
    startPause: useStartPause('pack'),
    endPause: useEndPause('pack'),
    react: useReact(),
    block: useBlock(),
  };
  useEffect(() => {
    hooks = current;
  });
  return null;
}

const SOON = 100;
let screen: ReactTestRenderer;
let client: QueryClient;

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockRead.mockReset().mockResolvedValue([]);
  mockSave.mockReset().mockResolvedValue({ data: null, error: null });
  mockSendFeed.mockReset().mockResolvedValue('feed');
  mockOnline.mockReset().mockResolvedValue(true);
  client = new QueryClient();
  await act(async () => {
    screen = create(
      <QueryClientProvider client={client}>
        <Screen />
      </QueryClientProvider>,
    );
  });
  await advance(1);
  mockRead.mockClear();
});

afterEach(async () => {
  await act(async () => {
    screen.unmount();
    client.clear();
  });
  jest.useRealTimers();
});

describe('a save while the reads fail', () => {
  beforeEach(() => {
    mockRead.mockRejectedValue(new Error('offline'));
    mockSave.mockResolvedValue(failed);
  });

  it('says a feed was kept for later at once, and the reads still run', async () => {
    mockOnline.mockResolvedValue(false);
    const outcome = jest.fn();
    void hooks.send.mutateAsync(feed).then(outcome);
    await advance(SOON);
    expect(outcome).toHaveBeenCalledWith('queued');
    expect(mockRead).toHaveBeenCalled();
    await advance(10_000);
    expect(mockRead).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['a rest day', (onError: () => void) => hooks.rest.mutate('rest', { onError })],
    ['an undone rest day', (onError: () => void) => hooks.undo.mutate(undefined, { onError })],
    ['a pause', (onError: () => void) => hooks.startPause.mutate(7, { onError })],
    ['the end of a pause', (onError: () => void) => hooks.endPause.mutate(undefined, { onError })],
    ['a reaction', (onError: () => void) => hooks.react.mutate({ feedId: 'f', emoji: 'fire' }, { onError })],
    ['a block', (onError: () => void) => hooks.block.mutate({ blockerId: 'noa', blockedId: 'dan' }, { onError })],
  ])('reports %s that failed at once, and the reads still run', async (_name, save) => {
    const onError = jest.fn();
    await act(async () => save(onError));
    await advance(SOON);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockRead).toHaveBeenCalled();
  });
});

describe('a save the server took while the reads never answer', () => {
  beforeEach(() => {
    mockRead.mockReturnValue(new Promise(() => undefined));
  });

  it('is done with a reaction, and runs the reload it cancelled again', async () => {
    const reload = jest.fn(() => new Promise<never>(() => undefined));
    const stop = new QueryObserver(client, { queryKey: [...packFeedsKey, 'pack', 30], queryFn: reload }).subscribe(() => undefined);
    await advance(1);

    const onSuccess = jest.fn();
    await act(async () => hooks.react.mutate({ feedId: 'f', emoji: 'fire' }, { onSuccess }));
    await advance(SOON);
    stop();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('says the feed was sent, and the reads still run', async () => {
    const outcome = jest.fn();
    void hooks.send.mutateAsync(feed).then(outcome);
    await advance(SOON);
    expect(outcome).toHaveBeenCalledWith('sent');
    expect(mockRead).toHaveBeenCalled();
  });

  it.each([
    ['a rest day', (onSuccess: () => void) => hooks.rest.mutate('rest', { onSuccess })],
    ['an undone rest day', (onSuccess: () => void) => hooks.undo.mutate(undefined, { onSuccess })],
    ['the end of a pause', (onSuccess: () => void) => hooks.endPause.mutate(undefined, { onSuccess })],
  ])('holds %s until the screen can show it', async (_name, save) => {
    const onSuccess = jest.fn();
    await act(async () => save(onSuccess));
    await advance(SOON);
    expect(mockRead).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
