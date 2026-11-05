import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { enqueue, flushQueue, forgetFeedsOf, forgetFeedsOfOthers, holdForSend, pendingFeeds, releaseFromSend } from '@/features/feeds/queue';
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
    delete() {
      mockDeleted.push(`${this.uri}/`);
    }
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

let mockOnline: boolean;
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: mockOnline, isInternetReachable: mockOnline }),
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
  AppState.currentState = 'active';
  mockSignedIn = 'noa';
  mockOnline = true;
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
    jest.requireActual<typeof import('react-native')>('react-native').AppState.currentState = 'active';
    queue = jest.requireActual<Queue>('@/features/feeds/queue');
  });
  return queue!;
}

/** Waits for what a run does in its own time. */
async function until(check: () => boolean) {
  for (let tries = 0; tries < 100 && !check(); tries += 1) await new Promise((resolve) => setTimeout(resolve));
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
    const cleared = forgetFeedsOf('noa');
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
    mockSendFeed.mockRejectedValueOnce({ code: 'P0001', message: 'too_many_posts' }).mockResolvedValueOnce('feed-id');
    expect((await flushQueue()).handled).toBe(2);
    expect(await pendingFeeds()).toEqual([]);
  });

  it('keeps a feed the server has no photo for, as this phone still does, and sends it on the next run', async () => {
    const missing = { code: 'P0001', message: 'photo_missing' };
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockRejectedValueOnce(missing).mockResolvedValue('feed-id');
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [missing] });
    expect(await waiting()).toEqual(['a']);
    expect(mockDeleted).toEqual(['documents/feed-queue/b.jpg']);

    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
    expect(await waiting()).toEqual([]);
  });

  it('posts a second feed of the day as an extra', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce({ code: 'P0001', message: 'already_fed' }).mockResolvedValueOnce('feed-id');
    await flushQueue();
    expect(mockSendFeed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', extra: true }));
  });

  it('tries an extra once more when another phone got to the day first', async () => {
    await enqueue({ ...feed('a'), extra: true });
    mockSendFeed.mockRejectedValueOnce({ code: 'P0001', message: 'already_fed' }).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
    expect(mockSendFeed).toHaveBeenCalledTimes(2);
    expect(await pendingFeeds()).toEqual([]);
  });

  it.each([
    ['a feed', feed('a')],
    ['an extra', { ...feed('a'), extra: true }],
  ])('stops at one more try for %s when the answer stays the same', async (_name, queued) => {
    await enqueue(queued);
    mockSendFeed.mockRejectedValue({ code: 'P0001', message: 'already_fed' });
    expect(await flushQueue()).toEqual({ handled: 1, dropped: ['P0001 already_fed'], unreported: ['P0001 already_fed'], stuck: [] });
    expect(mockSendFeed).toHaveBeenCalledTimes(2);
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

  it('forgets everything the account has waiting, with the folder of photos', async () => {
    await enqueue(feed('a'));
    await enqueue({ ...feed('b'), packId: 'other' });
    await forgetFeedsOf('noa');
    expect(await pendingFeeds()).toEqual([]);
    expect(mockDeleted).toEqual(['documents/feed-queue/']);
  });

  it('leaves what another account has waiting, with its photo', async () => {
    await enqueue(feed('a'));
    await enqueue({ ...feed('b'), userId: 'dan' });
    await forgetFeedsOf('noa');
    expect(await waiting()).toEqual(['b']);
    expect(mockDeleted).toEqual(['documents/feed-queue/a.jpg']);
  });

  it('lists what waits for one pack', async () => {
    await enqueue(feed('a'));
    await enqueue({ ...feed('b'), packId: 'other' });
    expect((await pendingFeeds('pack')).map((item) => item.id)).toEqual(['a']);
  });
});

describe('a feed Send is trying', () => {
  it('is left to Send by every run, and the start after the app was killed sends it', async () => {
    mockSendFeed.mockResolvedValue('feed-id');
    expect(await holdForSend(feed('a'))).toBe(true);
    await enqueue(feed('b'));

    expect((await flushQueue()).handled).toBe(1);
    expect(await waiting()).toEqual(['a']);

    expect((await afterRestart().flushQueue()).handled).toBe(1);
    expect(mockSendFeed.mock.calls.map(([sent]) => sent.id)).toEqual(['b', 'a']);
  });

  it('goes to the next run when the list fails as Send lets go of it', async () => {
    await holdForSend(feed('a'));
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
    await expect(releaseFromSend('a', null)).resolves.toBeUndefined();

    mockSendFeed.mockResolvedValue('feed-id');
    expect((await flushQueue()).handled).toBe(1);
  });
});

describe('feeds of different accounts', () => {
  const dansFeed = (id: string): OutgoingFeed => ({ ...feed(id), userId: 'dan' });

  it('goes past the feed of another account, untouched, to the signed-in one', async () => {
    await enqueue(dansFeed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockResolvedValue('feed-id');

    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });

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

    expect(await flushQueue()).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });

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
  const notAMember = { code: '42501', message: 'not_a_member' };
  const why = '42501 not_a_member';
  const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
  const noAnswer = [
    { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
    Object.assign(new Error('Network request failed'), { name: 'StorageUnknownError' }),
    new Error('not_signed_in'),
  ];

  it('says what it dropped: a final refusal, and a photo that is gone', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    await enqueue(feed('c'));
    mockMissing.add('documents/feed-queue/b.jpg');
    mockSendFeed.mockRejectedValueOnce(notAMember).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toEqual({ handled: 3, dropped: [why, 'queued_photo_gone'], unreported: [why, 'queued_photo_gone'], stuck: [] });
  });

  it('leaves out what the server wrote beside its refusal, which can quote a row', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce({ ...notAMember, details: 'Key (caption)=(my secret)' });
    expect((await flushQueue()).dropped).toEqual([why]);
  });

  it('says it at the next start when the app was killed before the run ended', async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    let cut = (_failure: unknown) => {};
    mockSendFeed.mockRejectedValueOnce(notAMember).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        cut = reject;
      }),
    );
    const killed = flushQueue();
    await until(() => mockSendFeed.mock.calls.length === 2);

    mockSendFeed.mockResolvedValue('feed-id');
    expect(await afterRestart().flushQueue()).toEqual({ handled: 1, dropped: [why], unreported: [why], stuck: [] });
    expect(await afterRestart().flushQueue()).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
    cut(networkFailure);
    await killed;
  });

  it('keeps it for a run with the app in front, off the list of what waits', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(notAMember);
    AppState.currentState = 'background';
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
    expect(await pendingFeeds()).toEqual([]);
    expect(mockDeleted).toEqual(['documents/feed-queue/a.jpg']);
    expect((await flushQueue()).dropped).toEqual([]);

    AppState.currentState = 'active';
    expect(await flushQueue()).toEqual({ handled: 0, dropped: [why], unreported: [why], stuck: [] });
    expect((await flushQueue()).dropped).toEqual([]);
    expect(mockSendFeed).toHaveBeenCalledTimes(1);
  });

  it('tells the member with no connection, and keeps the report for a run with one, also after the app starts again', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(notAMember);

    mockOnline = false;
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [why], unreported: [], stuck: [] });
    expect(await flushQueue()).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
    expect(await pendingFeeds()).toEqual([]);

    mockOnline = true;
    expect(await afterRestart().flushQueue()).toEqual({ handled: 0, dropped: [], unreported: [why], stuck: [] });
    expect(await afterRestart().flushQueue()).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
  });

  it('keeps it through a phone that fails to read the list, and says it once', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(notAMember);
    AppState.currentState = 'background';
    await flushQueue();
    AppState.currentState = 'active';

    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('disk I/O error'));
    expect((await flushQueue()).dropped).toEqual([]);
    expect((await flushQueue()).dropped).toEqual([why]);
    expect((await flushQueue()).dropped).toEqual([]);
  });

  it('says nothing to the next account of what the last one lost', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(notAMember);
    AppState.currentState = 'background';
    await flushQueue();
    AppState.currentState = 'active';

    mockSignedIn = 'dan';
    expect((await flushQueue()).dropped).toEqual([]);
    await forgetFeedsOfOthers('dan');
    mockSignedIn = 'noa';
    expect((await flushQueue()).dropped).toEqual([]);
  });

  it('forgets it when the account leaves the phone', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(notAMember);
    AppState.currentState = 'background';
    await flushQueue();
    AppState.currentState = 'active';

    await forgetFeedsOf('noa');
    expect((await flushQueue()).dropped).toEqual([]);
  });

  it('counts a feed that went out as its replacement as sent', async () => {
    await enqueue({ ...feed('a'), caption: 'Kicked ass today' });
    mockSendFeed.mockRejectedValueOnce({ code: '22023', message: 'text_not_allowed' }).mockResolvedValueOnce('feed-id');
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
  });

  it("doesn't call a network failure stuck", async () => {
    await enqueue(feed('a'));
    for (const failure of noAnswer) {
      mockSendFeed.mockRejectedValueOnce(failure);
      expect(await flushQueue()).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
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
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [timeout] });
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

  it('keeps what a stuck feed has to say for a run with a connection, where it can be heard', async () => {
    const unreadable = new Error('Unable to read the file');
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValue(unreadable);

    mockOnline = false;
    expect((await flushQueue()).stuck).toEqual([]);
    expect((await flushQueue()).stuck).toEqual([]);
    expect(await waiting()).toEqual(['a']);

    mockOnline = true;
    expect((await flushQueue()).stuck).toEqual([unreadable]);
    expect((await flushQueue()).stuck).toEqual([]);
  });

  it("keeps what the phone's storage has to say the same way", async () => {
    const restarted = afterRestart();
    const failure = new Error('disk I/O error');
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);

    mockOnline = false;
    expect((await restarted.flushQueue()).stuck).toEqual([]);

    mockOnline = true;
    expect((await restarted.flushQueue()).stuck).toEqual([failure]);
    expect((await restarted.flushQueue()).stuck).toEqual([]);
  });

  it('tells only the caller that started the run', async () => {
    await enqueue(feed('a'));
    mockSendFeed.mockRejectedValueOnce(notAMember);
    const [started, joined] = await Promise.all([flushQueue(), flushQueue()]);
    expect(started).toEqual({ handled: 1, dropped: [why], unreported: [why], stuck: [] });
    expect(joined).toEqual({ handled: 0, dropped: [], unreported: [], stuck: [] });
  });

  it("doesn't call feeds dropped when the queue was forgotten during the run", async () => {
    await enqueue(feed('a'));
    await enqueue(feed('b'));
    mockSendFeed.mockImplementationOnce(async () => {
      await forgetFeedsOf('noa');
      mockMissing.add('documents/feed-queue/b.jpg');
      return 'feed-id';
    });
    expect(await flushQueue()).toEqual({ handled: 1, dropped: [], unreported: [], stuck: [] });
    expect(mockSendFeed).toHaveBeenCalledTimes(1);
  });
});
