import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueue, flushQueue, pendingFeeds } from '@/features/feeds/queue';
import { sendFeed, type OutgoingFeed } from '@/features/feeds/send';

// Files are just names here, as in the queue test.
const mockUnreadable = new Set<string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    async copy() {}
    delete() {}
    async arrayBuffer() {
      if (mockUnreadable.has(this.uri)) throw new Error('Unable to read the file');
      return new ArrayBuffer(8);
    }
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
jest.mock('@react-native-community/netinfo', () => ({
  fetch: async () => ({ isConnected: true, isInternetReachable: true }),
}));
const mockSeed = jest.fn();
jest.mock('expo-image', () => ({ Image: { writeToCacheAsync: (...args: unknown[]) => mockSeed(...args) } }));

// A server that turns down anything sent without a session, the way storage's row level
// security answers the publishable key.
const mockGetSession = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  storedSession: async () => ({ user: { id: 'noa' } }),
  requireSupabase: () => ({
    auth: { getSession: () => mockGetSession() },
    storage: { from: () => ({ upload: mockUpload, remove: mockRemove }) },
    rpc: mockRpc,
  }),
}));

const feed: OutgoingFeed = {
  id: 'a',
  packId: 'pack',
  userId: 'noa',
  photoUri: 'cache/a.jpg',
  caption: null,
  capturedAt: '2026-09-27T20:00:00Z',
  focusMinutes: null,
  extra: false,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockUnreadable.clear();
  mockUpload.mockResolvedValue({ error: { statusCode: '403', message: 'new row violates row-level security policy' } });
  mockRemove.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: 'feed-id', error: null });
  mockSeed.mockResolvedValue(undefined);
});

describe('sending a queued feed', () => {
  it('keeps the feed while the session could not be renewed', async () => {
    // Back online after the access token expired, and the refresh failed on the first try.
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('Network request failed') });
    await enqueue(feed);

    expect((await flushQueue()).handled).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it('sends it once the session is back', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
    await enqueue(feed);

    expect((await flushQueue()).handled).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith('submit_feed', expect.objectContaining({ photo: 'pack/noa/a.jpg' }));
    expect(await pendingFeeds()).toEqual([]);
  });

  it('sends the feeds behind a photo that is there but can not be read, and keeps that one', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
    await enqueue(feed);
    await enqueue({ ...feed, id: 'b' });
    mockUnreadable.add('documents/feed-queue/a.jpg');

    expect((await flushQueue()).handled).toBe(1);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('submit_feed', expect.objectContaining({ photo: 'pack/noa/b.jpg' }));
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });
});

describe('a token that runs out inside the send', () => {
  // What the server answers a request that went out with no session.
  const signedOut = { code: '42501', message: 'permission denied for function submit_feed' };

  beforeEach(() => {
    mockGetSession
      .mockResolvedValueOnce({ data: { session: { access_token: 'token' } }, error: null })
      .mockResolvedValue({ data: { session: null }, error: new Error('Network request failed') });
    mockRpc.mockResolvedValue({ data: null, error: signedOut });
  });

  it('keeps the feed when the photo is refused', async () => {
    await enqueue(feed);

    expect(await flushQueue()).toEqual({ handled: 0, dropped: [], stuck: [] });
    expect(mockRpc).not.toHaveBeenCalled();
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it('keeps the feed and its photo when saving it is refused', async () => {
    mockUpload.mockResolvedValue({ error: null });
    await enqueue(feed);

    expect(await flushQueue()).toEqual({ handled: 0, dropped: [], stuck: [] });
    expect(mockRemove).not.toHaveBeenCalled();
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it('counts a refusal once the session is known to be there', async () => {
    mockGetSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not_a_member' } });
    await enqueue(feed);

    expect(await flushQueue()).toMatchObject({ handled: 1 });
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(await pendingFeeds()).toEqual([]);
  });
});

describe('a feed the server turns down for good', () => {
  const tooMany = { code: 'P0001', message: 'too_many_posts' };

  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: null, error: tooMany });
  });

  it('takes its photo off the server', async () => {
    await expect(sendFeed(feed)).rejects.toBe(tooMany);
    expect(mockRemove).toHaveBeenCalledWith(['pack/noa/a.jpg']);
  });

  it('leaves the photo there when the send was given up on: the next try has it now', async () => {
    await expect(sendFeed(feed, () => true)).rejects.toBe(tooMany);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe("the sender's own photo", () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
  });

  it('goes into the image cache under the id the feed card asks for', async () => {
    await expect(sendFeed(feed)).resolves.toBe('feed-id');
    expect(mockSeed).toHaveBeenCalledTimes(1);
    expect(mockSeed).toHaveBeenCalledWith('cache/a.jpg', 'feed-id');
  });

  it('goes in from the kept copy when the feed waited', async () => {
    await enqueue(feed);
    await flushQueue();
    expect(mockSeed).toHaveBeenCalledWith('documents/feed-queue/a.jpg', 'feed-id');
  });

  it('leaves the send alone when the cache refuses it', async () => {
    mockSeed.mockRejectedValue(new Error('Writing to the cache is not supported on Web.'));
    await expect(sendFeed(feed)).resolves.toBe('feed-id');
  });

  it('never waits for the cache', async () => {
    mockSeed.mockReturnValue(new Promise(() => undefined));
    await expect(sendFeed(feed)).resolves.toBe('feed-id');
  });

  it('stays out of the cache when the server turns the feed down', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'already_fed' } });
    await expect(sendFeed(feed)).rejects.toMatchObject({ message: 'already_fed' });
    expect(mockSeed).not.toHaveBeenCalled();
  });
});
