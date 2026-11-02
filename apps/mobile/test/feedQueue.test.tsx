import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, type ComponentType } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { useFeedQueue, useSendFeed } from '@/features/feeds/api';
import { enqueue, flushQueue, pendingFeeds } from '@/features/feeds/queue';
import type { OutgoingFeed } from '@/features/feeds/send';

// Files are just names here, as in the queue test.
const mockMissing = new Set<string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return !mockMissing.has(this.uri);
    }
    async copy() {}
    delete() {}
  }
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {}
  }
  return { File, Directory, Paths: { document: { uri: 'documents' } } };
});
jest.mock('expo-image-manipulator', () => ({}));

const mockSendFeed = jest.fn();
jest.mock('@/features/feeds/send', () => ({
  ...jest.requireActual('@/features/feeds/send'),
  sendFeed: (feed: OutgoingFeed) => mockSendFeed(feed),
}));

// The real listener hears the current state as soon as it subscribes, so a mount flushes twice.
type Connection = { isConnected: boolean; isInternetReachable?: boolean | null };
let mockConnected: ((state: Connection) => void) | null = null;
let mockOnline = true;
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }),
  addEventListener: (listener: (state: Connection) => void) => {
    mockConnected = listener;
    listener({ isConnected: true });
    return () => undefined;
  },
}));

const mockNotify = jest.fn();
jest.mock('@/lib/confirm', () => ({ notify: (...text: string[]) => mockNotify(...text) }));
const mockReport = jest.fn();
jest.mock('@/lib/reportError', () => ({
  ...jest.requireActual('@/lib/reportError'),
  reportError: (error: Error) => mockReport(error.message),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  requireSupabase: () => ({}),
  storedSession: async () => ({ user: { id: 'noa' } }),
}));

const feed = (id: string): OutgoingFeed => ({
  id,
  packId: 'pack',
  userId: 'noa',
  photoUri: `cache/${id}.jpg`,
  caption: null,
  capturedAt: '2026-09-27T20:00:00Z',
  focusMinutes: null,
  extra: false,
});

function Queue() {
  useFeedQueue();
  return null;
}

let app: ReactTestRenderer | undefined;

async function openApp(Screen: ComponentType = () => null) {
  // No garbage collection, whose timers would outlive the test.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <Queue />
        <Screen />
      </QueryClientProvider>,
    );
  });
  return client;
}

const mockLoadPacks = jest.fn();

/** A screen on the packs, whatever the queue is doing. */
function Packs() {
  useQuery<string[]>({ queryKey: ['packs'], queryFn: () => mockLoadPacks() });
  return null;
}

const connection = (state: Connection) =>
  act(async () => {
    mockConnected?.(state);
    await new Promise((resolve) => setTimeout(resolve));
  });

const appStates = new Set<(state: AppStateStatus) => void>();

const comeBackToApp = () =>
  act(async () => {
    AppState.currentState = 'active';
    appStates.forEach((listener) => listener('active'));
    await new Promise((resolve) => setTimeout(resolve));
  });

beforeEach(async () => {
  await AsyncStorage.clear();
  AppState.currentState = 'active';
  appStates.clear();
  jest.mocked(AppState.addEventListener).mockImplementation((_type, listener) => {
    appStates.add(listener);
    return { remove: () => appStates.delete(listener) };
  });
  mockSendFeed.mockReset();
  mockNotify.mockReset();
  mockReport.mockReset();
  mockMissing.clear();
  mockOnline = true;
  mockLoadPacks.mockReset().mockResolvedValue(['Gym squad']);
});

afterEach(async () => {
  await act(async () => app?.unmount());
  app = undefined;
});

describe('queued feeds that were dropped', () => {
  const whatToDo = 'Take a new photo if you still need to feed today.';

  it('tells the member once and the developer why, for a refusal at a start that flushes twice', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '42501', message: 'not_a_member' });
    await openApp();
    expect(mockNotify.mock.calls).toEqual([["A saved feed couldn't go out and was removed.", whatToDo]]);
    expect(mockReport.mock.calls).toEqual([['Queued feed dropped: 42501 not_a_member']]);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('says how many in one message, and reports each', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockMissing.add('documents/feed-queue/b.jpg');
    mockSendFeed.mockRejectedValue({ code: 'P0001', message: 'too_many_posts' });
    await openApp();
    expect(mockNotify.mock.calls).toEqual([["2 saved feeds couldn't go out and were removed.", whatToDo]]);
    expect(mockReport.mock.calls.flat()).toEqual([
      'Queued feed dropped: P0001 too_many_posts',
      'Queued feed dropped: queued_photo_gone',
    ]);
  });

  it('fits what Android shows of a title, with what to do under it', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '42501', message: 'not_a_member' });
    await openApp();
    const [title, detail] = mockNotify.mock.calls[0] as [string, string];
    expect(title.length).toBeLessThan(50);
    expect(detail).toBe(whatToDo);
  });

  it('says nothing when everything went out', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockResolvedValue('feed-id');
    await openApp();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('waits for the app to be in front, where the alert can show, and says it once', async () => {
    AppState.currentState = 'background';
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '42501', message: 'not_a_member' });
    await openApp();
    expect(await pendingFeeds()).toEqual([]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();

    await comeBackToApp();
    await comeBackToApp();
    expect(mockNotify.mock.calls).toEqual([["A saved feed couldn't go out and was removed.", whatToDo]]);
    expect(mockReport.mock.calls).toEqual([['Queued feed dropped: 42501 not_a_member']]);
  });

  it('tells the member without a connection, and reports once on a run with one', async () => {
    AppState.currentState = 'background';
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '42501', message: 'not_a_member' });
    await openApp();

    mockOnline = false;
    await comeBackToApp();
    await comeBackToApp();
    expect(mockNotify.mock.calls).toEqual([["A saved feed couldn't go out and was removed.", whatToDo]]);
    expect(mockReport).not.toHaveBeenCalled();
    expect(await pendingFeeds()).toEqual([]);

    mockOnline = true;
    await comeBackToApp();
    await comeBackToApp();
    expect(mockReport.mock.calls).toEqual([['Queued feed dropped: 42501 not_a_member']]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('does the same for a run with no connection that finds a photo gone', async () => {
    await enqueue(feed('a'));
    mockMissing.add('documents/feed-queue/a.jpg');
    mockOnline = false;
    await openApp();
    expect(mockNotify.mock.calls).toEqual([["A saved feed couldn't go out and was removed.", whatToDo]]);
    expect(mockReport).not.toHaveBeenCalled();

    mockOnline = true;
    await comeBackToApp();
    expect(mockReport.mock.calls).toEqual([['Queued feed dropped: queued_photo_gone']]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });
});

describe('a queue that is stuck', () => {
  it('reports what stopped it once, not on every run, and bothers nobody on the phone', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '57014', message: 'canceling statement due to statement timeout' });
    await openApp();
    await act(async () => {
      mockConnected?.({ isConnected: true });
    });
    await act(async () => {
      mockConnected?.({ isConnected: true });
    });
    expect(mockSendFeed.mock.calls.length).toBeGreaterThan(1);
    expect(mockReport.mock.calls).toEqual([['Feed queue stuck: 57014 canceling statement due to statement timeout']]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it('reports each feed that is stuck, and sends the ones it can', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    await enqueue(feed('c'));
    mockSendFeed
      .mockRejectedValueOnce(new Error('Unable to read the file'))
      .mockRejectedValueOnce({ code: '57014', message: 'canceling statement due to statement timeout' })
      .mockResolvedValue('feed-id');
    await openApp();
    expect(mockReport.mock.calls.flat()).toEqual([
      'Feed queue stuck: Unable to read the file',
      'Feed queue stuck: 57014 canceling statement due to statement timeout',
    ]);
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it("doesn't report a network failure", async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '', message: 'TypeError: Network request failed' });
    await openApp();
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('the connection', () => {
  it('coming back reloads what is on screen', async () => {
    await openApp(Packs);
    await connection({ isConnected: false });
    await connection({ isConnected: true });
    expect(mockLoadPacks).toHaveBeenCalledTimes(2);
  });

  it('reloads once for each time it comes back', async () => {
    await openApp(Packs);
    await connection({ isConnected: false });
    await connection({ isConnected: true });
    await connection({ isConnected: true });
    await connection({ isConnected: false });
    await connection({ isConnected: false });
    await connection({ isConnected: true });
    expect(mockLoadPacks).toHaveBeenCalledTimes(3);
  });

  it("reloads nothing when it was there all along, as at the start or when it changes hands", async () => {
    await openApp(Packs);
    await connection({ isConnected: true, isInternetReachable: null });
    await connection({ isConnected: true, isInternetReachable: true });
    expect(mockLoadPacks).toHaveBeenCalledTimes(1);
  });

  it("isn't back until the internet behind it is", async () => {
    await openApp(Packs);
    await connection({ isConnected: false, isInternetReachable: false });
    await connection({ isConnected: true, isInternetReachable: false });
    expect(mockLoadPacks).toHaveBeenCalledTimes(1);
    await connection({ isConnected: true, isInternetReachable: true });
    expect(mockLoadPacks).toHaveBeenCalledTimes(2);
  });

  it('keeps what the screen had when the reload fails', async () => {
    const client = await openApp(Packs);
    await connection({ isConnected: false });
    mockLoadPacks.mockRejectedValue(new TypeError('Network request failed'));
    await connection({ isConnected: true });
    expect(mockLoadPacks).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(['packs'])).toEqual(['Gym squad']);
  });
});

describe('the Send button', () => {
  const alreadyFed = { code: 'P0001', message: 'already_fed' };
  const noAnswer = { message: 'TypeError: Network request failed', details: '', hint: '', code: '' };

  async function tapSend(outgoing: OutgoingFeed): Promise<'sent' | 'queued'> {
    let send: ReturnType<typeof useSendFeed>['mutateAsync'] | null = null;
    function Screen() {
      const { mutateAsync } = useSendFeed();
      useEffect(() => {
        send = mutateAsync;
      }, [mutateAsync]);
      return null;
    }
    const client = new QueryClient({ defaultOptions: { mutations: { gcTime: 0 } } });
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Screen />
        </QueryClientProvider>,
      );
    });
    let outcome: 'sent' | 'queued' | undefined;
    await act(async () => {
      outcome = await send!(outgoing);
    });
    return outcome!;
  }

  it('posts an extra when the day was fed from another phone', async () => {
    mockSendFeed.mockRejectedValueOnce(alreadyFed).mockResolvedValueOnce('feed-id');
    expect(await tapSend(feed('a'))).toBe('sent');
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', extra: true }));
    expect(await pendingFeeds()).toEqual([]);
  });

  it('tries an extra once more when another phone got to the day first', async () => {
    mockSendFeed.mockRejectedValueOnce(alreadyFed).mockResolvedValueOnce('feed-id');
    expect(await tapSend({ ...feed('a'), extra: true })).toBe('sent');
    expect(mockSendFeed).toHaveBeenCalledTimes(2);
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', extra: true }));
  });

  it.each([
    ['a feed', feed('a')],
    ['an extra', { ...feed('a'), extra: true }],
  ])('stops at one more try for %s when the answer stays the same', async (_name, outgoing) => {
    mockSendFeed.mockRejectedValue(alreadyFed);
    await expect(tapSend(outgoing)).rejects.toBe(alreadyFed);
    expect(mockSendFeed).toHaveBeenCalledTimes(2);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('keeps the feed as an extra when that second try gets no answer, and the queue sends it', async () => {
    mockSendFeed.mockRejectedValueOnce(alreadyFed).mockRejectedValueOnce(noAnswer);
    expect(await tapSend(feed('a'))).toBe('queued');
    expect(await pendingFeeds()).toEqual([expect.objectContaining({ id: 'a', extra: true })]);

    mockSendFeed.mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(1);
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', extra: true }));
  });

  it('keeps the feed as it was when the first try gets no answer', async () => {
    mockSendFeed.mockRejectedValueOnce(noAnswer);
    expect(await tapSend(feed('a'))).toBe('queued');
    expect(await pendingFeeds()).toEqual([expect.objectContaining({ id: 'a', extra: false })]);
  });

  it('answers with the refusal when the second try is turned down for good', async () => {
    const tooMany = { code: 'P0001', message: 'too_many_posts' };
    mockSendFeed.mockRejectedValueOnce(alreadyFed).mockRejectedValueOnce(tooMany);
    await expect(tapSend(feed('a'))).rejects.toBe(tooMany);
    expect(await pendingFeeds()).toEqual([]);
  });
});

describe('a queued feed that went out', () => {
  it('reloads the pack too: the feed woke its sender and took back their pass', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockResolvedValue('feed-id');
    await openApp(Packs);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(mockSendFeed).toHaveBeenCalledTimes(1);
    expect(mockLoadPacks).toHaveBeenCalledTimes(2);
  });
});
