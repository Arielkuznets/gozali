import { Platform } from 'react-native';

import { clearShotFiles, enqueue, flushQueue } from '@/features/feeds/queue';

// Folders are just names here, as in the queue test.
const mockDeleted: string[] = [];
const mockMissing = new Set<string>();
const mockBroken = new Set<string>();
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    get exists() {
      return !mockMissing.has(this.uri);
    }
    create() {}
    delete() {
      if (mockBroken.has(this.uri)) throw new Error('failed to delete');
      mockDeleted.push(this.uri);
    }
  }
  class File extends Directory {
    async copy() {}
  }
  return { File, Directory, Paths: { cache: { uri: 'cache' }, document: { uri: 'documents' } } };
});

const mockSendFeed = jest.fn();
jest.mock('@/features/feeds/send', () => ({
  ...jest.requireActual('@/features/feeds/send'),
  sendFeed: (feed: unknown) => mockSendFeed(feed),
}));
jest.mock('@/lib/supabase', () => ({ storedSession: async () => ({ user: { id: 'noa' } }) }));

const platform = Platform.OS;

beforeEach(() => {
  mockDeleted.length = 0;
  mockMissing.clear();
  mockBroken.clear();
  mockSendFeed.mockReset().mockResolvedValue('feed-id');
  Platform.OS = platform;
});

describe('clearing what the camera and the compressor leave behind', () => {
  it('clears their two folders and no other', () => {
    clearShotFiles();
    expect(mockDeleted).toEqual(['cache/Camera', 'cache/ImageManipulator']);
  });

  it('leaves a waiting feed, which still goes out with its own copy', async () => {
    await enqueue({
      id: 'a',
      packId: 'pack',
      userId: 'noa',
      photoUri: 'cache/ImageManipulator/a.jpg',
      caption: null,
      capturedAt: '2026-09-27T20:00:00Z',
      focusMinutes: null,
      extra: false,
    });
    clearShotFiles();
    expect(mockDeleted.filter((uri) => uri.startsWith('documents'))).toEqual([]);

    expect((await flushQueue()).handled).toBe(1);
    expect(mockSendFeed.mock.calls[0]?.[0].photoUri).toBe('documents/feed-queue/a.jpg');
  });

  it('skips a folder that is not there', () => {
    mockMissing.add('cache/Camera');
    clearShotFiles();
    expect(mockDeleted).toEqual(['cache/ImageManipulator']);
  });

  it("goes on after a folder that can't be cleared, and throws nothing", () => {
    mockBroken.add('cache/Camera');
    expect(() => clearShotFiles()).not.toThrow();
    expect(mockDeleted).toEqual(['cache/ImageManipulator']);
  });

  it('does nothing on the web, which has no such folders', () => {
    Platform.OS = 'web';
    clearShotFiles();
    expect(mockDeleted).toEqual([]);
  });
});
