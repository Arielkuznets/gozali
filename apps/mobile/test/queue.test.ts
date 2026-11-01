import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearQueue, enqueue, flushQueue, pendingFeeds } from '@/features/feeds/queue';
import type { OutgoingFeed } from '@/features/feeds/send';

// The queue keeps photos in the app's documents folder; here files are just names.
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return !mockMissing.has(this.uri);
    }
    copy() {
      return mockCopy();
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  }
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {}
    delete() {}
  }
  return { File, Directory, Paths: { document: { uri: 'documents' } } };
});

const mockMissing = new Set<string>();
const mockDeleted: string[] = [];
const mockCopy = jest.fn();
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
  mockCopy.mockReset().mockResolvedValue(undefined);
  mockMissing.clear();
  mockDeleted.length = 0;
});

const waiting = async () => (await pendingFeeds()).map((item) => item.id);

/** Holds the next write to the list back until the test lets it finish. */
function holdNextWrite() {
  const setItem = jest.mocked(AsyncStorage.setItem);
  const write = setItem.getMockImplementation()!;
  let finish = () => {};
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = new Promise<void>((resolve) => {
    setItem.mockImplementationOnce(async (key, value) => {
      resolve();
      await held;
      await write(key, value);
    });
  });
  return { started, finish };
}

// Reading a file that isn't there throws, which is not a refusal from the server.
const sendsWhatExists = async (sent: OutgoingFeed) => {
  if (mockMissing.has(sent.photoUri)) throw new Error('file not found');
  return 'feed-id';
};

describe('offline feed queue', () => {
  it("answers with the failure when the photo can't be kept, and lists nothing", async () => {
    mockCopy.mockRejectedValueOnce(new Error('No space left on device'));
    await expect(enqueue(feed('a'))).rejects.toThrow('No space left on device');
    expect(await pendingFeeds()).toEqual([]);
  });

  it('lists a feed only once its photo is in place', async () => {
    let finishCopy = () => {};
    mockCopy.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishCopy = resolve;
      }),
    );
    const queued = enqueue(feed('a'));
    await new Promise((resolve) => setTimeout(resolve));
    expect(await pendingFeeds()).toEqual([]);
    finishCopy();
    await queued;
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it("answers with the failure when the list can't be read, and keeps what waits", async () => {
    await enqueue(feed('a'));
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
    await expect(enqueue(feed('b'))).rejects.toThrow('disk I/O error');
    expect(await waiting()).toEqual(['a']);
  });

  it('keeps no photo of a feed it could not list', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
    await expect(enqueue(feed('a'))).rejects.toThrow('disk I/O error');
    expect(mockDeleted).toEqual(['documents/feed-queue/a.jpg']);
  });

  it('counts a list nothing can read as empty', async () => {
    await AsyncStorage.setItem('gozali.feed-queue', '{not json');
    expect(await pendingFeeds()).toEqual([]);
    await enqueue(feed('a'));
    expect(await waiting()).toEqual(['a']);
  });

  it('keeps a feed queued while a run takes another off the list', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockResolvedValue('feed-id');
    const write = holdNextWrite();
    const run = flushQueue();
    await write.started;
    const queued = enqueue(feed('b'));
    await new Promise((resolve) => setTimeout(resolve));
    write.finish();
    await Promise.all([run, queued]);
    expect(await waiting()).toEqual(['b']);
  });

  it('stays empty when a write was on its way as the queue was forgotten', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockResolvedValueOnce('feed-id').mockRejectedValueOnce(new TypeError('Network request failed'));
    const write = holdNextWrite();
    const run = flushQueue();
    await write.started;
    const cleared = clearQueue();
    await new Promise((resolve) => setTimeout(resolve));
    write.finish();
    await Promise.all([run, cleared]);
    expect(await pendingFeeds()).toEqual([]);
  });

  it("leaves the list alone when it can't be read while taking a sent feed off it", async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockImplementationOnce(async () => {
      jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
      return 'feed-id';
    });
    await flushQueue();
    expect(await waiting()).toEqual(['a', 'b']);
  });

  it('keeps a feed through a failed read after a refused caption', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    await enqueue(feed('b'));
    mockSendFeed.mockImplementationOnce(async () => {
      jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
      throw { code: '22023', message: 'text_not_allowed' };
    });
    await flushQueue();
    expect(await waiting()).toEqual(['a', 'b']);
  });

  it("ends a run that can't read the list, and the next one sends", async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockResolvedValue('feed-id');
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
    expect(await flushQueue()).toBe(0);
    expect(mockSendFeed).not.toHaveBeenCalled();
    expect(await flushQueue()).toBe(1);
  });

  it('goes past a feed whose photo is gone', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockMissing.add('documents/feed-queue/a.jpg');
    mockSendFeed.mockImplementation(sendsWhatExists);
    expect(await flushQueue()).toBe(2);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['b']);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('finds the photo by its name when the app moved to a new folder', async () => {
    await enqueue(feed('a'));
    const [queued] = await pendingFeeds();
    await AsyncStorage.setItem(
      'gozali.feed-queue',
      JSON.stringify([{ ...queued, photoUri: 'old-container/feed-queue/a.jpg' }]),
    );
    mockMissing.add('old-container/feed-queue/a.jpg');
    mockSendFeed.mockImplementation(sendsWhatExists);
    expect(await flushQueue()).toBe(1);
    expect(mockSendFeed.mock.calls[0][0].photoUri).toBe('documents/feed-queue/a.jpg');
    expect(await pendingFeeds()).toEqual([]);
  });

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

  it('keeps a feed through a refusal that can pass later', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce({ statusCode: '403', message: '"exp" claim timestamp check failed' });
    expect(await flushQueue()).toBe(0);
    mockSendFeed.mockRejectedValueOnce({ code: '57014', message: 'canceling statement due to statement timeout' });
    expect(await flushQueue()).toBe(0);
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
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

  it('still feeds when the word filter turns down the caption it was queued with', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed.mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' }).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toBe(1);
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', caption: null }));
  });

  it('keeps a feed whose second try meets a network error, without the refused caption', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed
      .mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' })
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await flushQueue()).toBe(0);
    expect(await pendingFeeds()).toEqual([expect.objectContaining({ id: 'a', caption: null })]);
  });

  it('posts a feed without its refused caption as an extra when the day was fed meanwhile', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed
      .mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' })
      .mockRejectedValueOnce({ code: 'P0001', message: 'already_fed' })
      .mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toBe(1);
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', caption: null, extra: true }));
    expect(await pendingFeeds()).toEqual([]);
  });

  it('forgets everything that waits', async () => {
    await enqueue(feed('a'));
    await enqueue({ ...feed('b'), packId: 'other' });
    await clearQueue();
    expect(await pendingFeeds()).toEqual([]);
  });

  it('lists what waits for one pack', async () => {
    await enqueue(feed('a'));
    await enqueue({ ...feed('b'), packId: 'other' });
    expect((await pendingFeeds('pack')).map((item) => item.id)).toEqual(['a']);
  });
});
