import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueue, flushQueue, pendingFeeds } from '@/features/feeds/queue';
import type { OutgoingFeed } from '@/features/feeds/send';

// The queue keeps photos in the app's documents folder; here files are just names.
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    copy() {}
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

const mockSendFeed = jest.fn();
jest.mock('@/features/feeds/send', () => ({
  ...jest.requireActual('@/features/feeds/send'),
  sendFeed: (feed: OutgoingFeed) => mockSendFeed(feed),
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

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSendFeed.mockReset();
});

describe('offline feed queue', () => {
  it('keeps feeds in order and sends them oldest first', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockResolvedValue('feed-id');
    expect(await flushQueue()).toBe(2);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['a', 'b']);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('stops at a network error and keeps the rest for later', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await flushQueue()).toBe(0);
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('drops a feed the server refused for good and goes on', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValueOnce({ code: 'P0001', message: 'photo_missing' }).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toBe(2);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('posts a second feed of the day as an extra', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce({ code: 'P0001', message: 'already_fed' }).mockResolvedValueOnce('feed-id');
    await flushQueue();
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', extra: true }));
  });

  it('lists what waits for one pack', async () => {
    await enqueue(feed('a'));
    await enqueue({ ...feed('b'), packId: 'other' });
    expect((await pendingFeeds('pack')).map((item) => item.id)).toEqual(['a']);
  });
});
