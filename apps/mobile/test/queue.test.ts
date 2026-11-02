import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearQueue, enqueue, flushQueue, forgetFeedsOfOthers, pendingFeeds } from '@/features/feeds/queue';
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

// Whose session the phone holds; the feeds here are Noa's unless a test says otherwise.
let mockSignedIn: string | null;
jest.mock('@/lib/supabase', () => ({
  storedSession: async () => (mockSignedIn ? { user: { id: mockSignedIn } } : null),
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
  mockSignedIn = 'noa';
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

/** The queue as the next start of the app finds it. */
function afterRestart() {
  type Queue = typeof import('@/features/feeds/queue');
  let queue: Queue | undefined;
  jest.isolateModules(() => {
    queue = jest.requireActual<Queue>('@/features/feeds/queue');
  });
  return queue!;
}

/** What supabase-js hands back when a request gets no answer. */
const networkFailure = { message: 'TypeError: Network request failed', details: '', hint: '', code: '' };

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
    mockSendFeed.mockResolvedValueOnce('feed-id').mockRejectedValueOnce(networkFailure);
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
    expect((await flushQueue()).handled).toBe(0);
    expect(mockSendFeed).not.toHaveBeenCalled();
    expect((await flushQueue()).handled).toBe(1);
  });

  it('goes past a feed whose photo is gone', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockMissing.add('documents/feed-queue/a.jpg');
    mockSendFeed.mockImplementation(sendsWhatExists);
    expect((await flushQueue()).handled).toBe(2);
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
    expect((await flushQueue()).handled).toBe(1);
    expect(mockSendFeed.mock.calls[0][0].photoUri).toBe('documents/feed-queue/a.jpg');
    expect(await pendingFeeds()).toEqual([]);
  });

  it('keeps feeds in order and sends them oldest first', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockResolvedValue('feed-id');
    expect((await flushQueue()).handled).toBe(2);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['a', 'b']);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('stops at a network error and keeps the rest for later', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValueOnce(networkFailure);
    expect((await flushQueue()).handled).toBe(0);
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('goes on past a feed stuck on anything but the network, and keeps it', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValueOnce(new Error('Unable to read the file')).mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(1);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['a', 'b']);
    expect(await waiting()).toEqual(['a']);
  });

  it('tries each stuck feed once a run, and sends it when it can go', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValue(new Error('Unable to read the file'));
    expect((await flushQueue()).handled).toBe(0);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['a', 'b']);
    mockSendFeed.mockReset().mockResolvedValue('feed-id');
    expect((await flushQueue()).handled).toBe(2);
    expect(await waiting()).toEqual([]);
  });

  it('stops at a network error behind a stuck feed', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    await enqueue(feed('c'));
    mockSendFeed
      .mockRejectedValueOnce(new Error('Unable to read the file'))
      .mockRejectedValueOnce(networkFailure);
    expect((await flushQueue()).handled).toBe(0);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['a', 'b']);
    expect(await waiting()).toEqual(['a', 'b', 'c']);
  });

  it('sends a feed queued while the one before it was stuck', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockImplementationOnce(async () => {
      await enqueue(feed('b'));
      throw new Error('Unable to read the file');
    });
    mockSendFeed.mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(1);
    expect(await waiting()).toEqual(['a']);
  });

  it('keeps a feed through a refusal that can pass later', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce({ statusCode: '403', message: '"exp" claim timestamp check failed' });
    expect((await flushQueue()).handled).toBe(0);
    mockSendFeed.mockRejectedValueOnce({ code: '57014', message: 'canceling statement due to statement timeout' });
    expect((await flushQueue()).handled).toBe(0);
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it('drops a feed the server refused for good and goes on', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValueOnce({ code: 'P0001', message: 'photo_missing' }).mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(2);
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
    expect((await flushQueue()).handled).toBe(1);
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', caption: null }));
  });

  it('keeps a feed whose second try meets a network error, without the refused caption', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed
      .mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' })
      .mockRejectedValueOnce(networkFailure);
    expect((await flushQueue()).handled).toBe(0);
    expect(await pendingFeeds()).toEqual([expect.objectContaining({ id: 'a', caption: null })]);
  });

  it('posts a feed without its refused caption as an extra when the day was fed meanwhile', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed
      .mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' })
      .mockRejectedValueOnce({ code: 'P0001', message: 'already_fed' })
      .mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(1);
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', caption: null, extra: true }));
    expect(await pendingFeeds()).toEqual([]);
  });

  it('sends a feed queued during the run, in the same run', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockImplementationOnce(async () => {
      await enqueue(feed('b'));
      return 'feed-id';
    });
    mockSendFeed.mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(2);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['a', 'b']);
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

describe('feeds of different accounts', () => {
  const dansFeed = (id: string): OutgoingFeed => ({ ...feed(id), userId: 'dan' });

  it('goes past the feed of another account, untouched, to the signed-in one', async () => {
    await enqueue(dansFeed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockResolvedValue('feed-id');

    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], stuck: [] });

    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['b']);
    expect(await waiting()).toEqual(['a']);
    expect(mockDeleted).toEqual(['documents/feed-queue/b.jpg']);
  });

  it('sends a feed once its own account is back', async () => {
    await enqueue(dansFeed('a'));
    mockSendFeed.mockResolvedValue('feed-id');
    expect((await flushQueue()).handled).toBe(0);

    mockSignedIn = 'dan';

    expect((await flushQueue()).handled).toBe(1);
    expect(await waiting()).toEqual([]);
  });

  it('sends nothing with nobody signed in', async () => {
    mockSignedIn = null;
    await enqueue(feed('a'));

    expect(await flushQueue()).toEqual({ handled: 0, dropped: [], stuck: [] });

    expect(mockSendFeed).not.toHaveBeenCalled();
    expect(await waiting()).toEqual(['a']);
  });

  it("forgets the feeds and photos of the others, and keeps the account's own", async () => {
    await enqueue(dansFeed('a'));
    await enqueue(feed('b'));
    await enqueue(dansFeed('c'));

    await forgetFeedsOfOthers('noa');

    expect(await waiting()).toEqual(['b']);
    expect(mockDeleted).toEqual(['documents/feed-queue/a.jpg', 'documents/feed-queue/c.jpg']);
  });

  it('leaves the list alone when there are no others', async () => {
    await enqueue(feed('a'));
    jest.mocked(AsyncStorage.setItem).mockClear();

    await forgetFeedsOfOthers('noa');

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});

describe('what a run tells its caller', () => {
  const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
  const noAnswer = [
    { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
    Object.assign(new Error('Network request failed'), { name: 'StorageUnknownError' }),
    new Error('not_signed_in'),
  ];

  it('says what it dropped: a final refusal, and a photo that is gone', async () => {
    const refusal = { code: '42501', message: 'not_a_member' };
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    await enqueue(feed('c'));
    mockMissing.add('documents/feed-queue/b.jpg');
    mockSendFeed.mockRejectedValueOnce(refusal).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toEqual({ handled: 3, dropped: [refusal, expect.any(Error)], stuck: [] });
  });

  it('counts a feed that went out as its replacement as sent', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed.mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' }).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], stuck: [] });
  });

  it("doesn't call a network failure stuck", async () => {
    await enqueue(feed('a'));
    for (const failure of noAnswer) {
      mockSendFeed.mockRejectedValueOnce(failure);
      expect(await flushQueue()).toEqual({ handled: 0, dropped: [], stuck: [] });
    }
  });

  it('says once per feed what it is stuck on, also after the app starts again', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValue(timeout);
    expect((await flushQueue()).stuck).toEqual([timeout, timeout]);
    expect((await flushQueue()).stuck).toEqual([]);
    expect((await afterRestart().flushQueue()).stuck).toEqual([]);
    expect(await waiting()).toEqual(['a', 'b']);
  });

  it('says it again for the next feed that gets stuck', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(timeout);
    expect((await flushQueue()).stuck).toEqual([timeout]);
    await enqueue(feed('b'));
    mockSendFeed.mockResolvedValueOnce('feed-id').mockRejectedValueOnce(timeout);
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], stuck: [timeout] });
  });

  it('keeps quiet about a stuck feed through its replacement', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed.mockRejectedValueOnce(timeout);
    expect((await flushQueue()).stuck).toEqual([timeout]);
    mockSendFeed.mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' }).mockRejectedValueOnce(timeout);
    expect((await flushQueue()).stuck).toEqual([]);
    expect(await pendingFeeds()).toEqual([expect.objectContaining({ id: 'a', caption: null })]);
  });

  it("says once per start of the app that the phone's storage failed", async () => {
    const restarted = afterRestart();
    const failure = new Error('disk I/O error');
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
    expect((await restarted.flushQueue()).stuck).toEqual([failure]);
    expect((await restarted.flushQueue()).stuck).toEqual([]);
  });

  it('tells only the caller that started the run', async () => {
    const refusal = { code: '42501', message: 'not_a_member' };
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(refusal);
    const [started, joined] = await Promise.all([flushQueue(), flushQueue()]);
    expect(started).toEqual({ handled: 1, dropped: [refusal], stuck: [] });
    expect(joined).toEqual({ handled: 0, dropped: [], stuck: [] });
  });

  it("doesn't call feeds dropped when the queue was forgotten during the run", async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockImplementationOnce(async () => {
      await clearQueue();
      mockMissing.add('documents/feed-queue/b.jpg');
      return 'feed-id';
    });
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], stuck: [] });
    expect(mockSendFeed).toHaveBeenCalledTimes(1);
  });
});
