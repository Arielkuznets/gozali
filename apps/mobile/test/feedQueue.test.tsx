import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import '@/i18n';
import { useFeedQueue } from '@/features/feeds/api';
import { enqueue, pendingFeeds } from '@/features/feeds/queue';
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
let mockConnected: ((state: { isConnected: boolean }) => void) | null = null;
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (listener: (state: { isConnected: boolean }) => void) => {
    mockConnected = listener;
    listener({ isConnected: true });
    return () => undefined;
  },
}));

const mockNotify = jest.fn();
jest.mock('@/lib/confirm', () => ({ notify: (message: string) => mockNotify(message) }));
const mockReport = jest.fn();
jest.mock('@/lib/reportError', () => ({
  ...jest.requireActual('@/lib/reportError'),
  reportError: (error: Error) => mockReport(error.message),
}));
jest.mock('@/lib/supabase', () => ({ supabase: null, requireSupabase: () => ({}) }));

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

async function openApp() {
  const client = new QueryClient();
  await act(async () => {
    create(
      <QueryClientProvider client={client}>
        <Queue />
      </QueryClientProvider>,
    );
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSendFeed.mockReset();
  mockNotify.mockReset();
  mockReport.mockReset();
  mockMissing.clear();
});

describe('queued feeds that were dropped', () => {
  it('tells the member once and the developer why, for a refusal at a start that flushes twice', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '42501', message: 'not_a_member' });
    await openApp();
    expect(mockNotify.mock.calls).toEqual([[expect.stringContaining("couldn't go out")]]);
    expect(mockReport.mock.calls).toEqual([['Queued feed dropped: 42501 not_a_member']]);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('says how many in one message, and reports each', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockMissing.add('documents/feed-queue/b.jpg');
    mockSendFeed.mockRejectedValue({ code: 'P0001', message: 'too_many_posts' });
    await openApp();
    expect(mockNotify.mock.calls).toEqual([[expect.stringContaining("2 saved feeds couldn't go out")]]);
    expect(mockReport.mock.calls.flat()).toEqual([
      'Queued feed dropped: P0001 too_many_posts',
      'Queued feed dropped: queued_photo_gone',
    ]);
  });

  it('says nothing when everything went out', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockResolvedValue('feed-id');
    await openApp();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
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

  it("doesn't report a network failure", async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue({ code: '', message: 'TypeError: Network request failed' });
    await openApp();
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
