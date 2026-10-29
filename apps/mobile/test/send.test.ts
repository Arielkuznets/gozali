import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueue, flushQueue, pendingFeeds } from '@/features/feeds/queue';
import type { OutgoingFeed } from '@/features/feeds/send';

// Files are just names here, as in the queue test.
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    exists = true;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    copy() {}
    delete() {}
    async arrayBuffer() {
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

// A server that turns down anything sent without a session, the way storage's row level
// security answers the publishable key.
const mockGetSession = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
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
  mockUpload.mockResolvedValue({ error: { statusCode: '403', message: 'new row violates row-level security policy' } });
  mockRemove.mockResolvedValue({ error: null });
  mockRpc.mockResolvedValue({ data: 'feed-id', error: null });
});

describe('sending a queued feed', () => {
  it('keeps the feed while the session could not be renewed', async () => {
    // Back online after the access token expired, and the refresh failed on the first try.
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('Network request failed') });
    await enqueue(feed);

    expect(await flushQueue()).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
    expect((await pendingFeeds()).map((item) => item.id)).toEqual(['a']);
  });

  it('sends it once the session is back', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
    await enqueue(feed);

    expect(await flushQueue()).toBe(1);
    expect(mockRpc).toHaveBeenCalledWith('submit_feed', expect.objectContaining({ photo: 'pack/noa/a.jpg' }));
    expect(await pendingFeeds()).toEqual([]);
  });
});
