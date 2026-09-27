import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { feedErrorCode, isFinalRejection, sendFeed, type OutgoingFeed } from '@/features/feeds/send';

// Feeds taken without a connection wait here and go out when it returns (spec section 6).
// The photo is copied into the app's documents so the system can't clear it meanwhile.
const STORAGE_KEY = 'gozali.feed-queue';

async function read(): Promise<OutgoingFeed[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutgoingFeed[]) : [];
  } catch {
    return [];
  }
}

async function write(queue: OutgoingFeed[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

function queueDirectory(): Directory {
  const directory = new Directory(Paths.document, 'feed-queue');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return state.isConnected !== false && state.isInternetReachable !== false;
}

/** Keeps a feed for later. Web has no durable file storage, so there it is dropped. */
export async function enqueue(feed: OutgoingFeed): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const kept = new File(queueDirectory(), `${feed.id}.jpg`);
  new File(feed.photoUri).copy(kept);
  await write([...(await read()), { ...feed, photoUri: kept.uri }]);
  return true;
}

export async function pendingFeeds(packId?: string): Promise<OutgoingFeed[]> {
  const queue = await read();
  return packId ? queue.filter((feed) => feed.packId === packId) : queue;
}

let flushing: Promise<number> | null = null;

/**
 * Sends what is waiting, oldest first; returns how many were handled. A feed the server turns
 * down for good (already fed, or no longer a member) is dropped; a network error stops the run.
 */
export function flushQueue(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      for (const feed of await read()) {
        try {
          await sendFeed(feed);
        } catch (error) {
          if (!isFinalRejection(error)) break;
          // Fed from another phone meanwhile: the photo still goes up, as an extra post.
          if (feedErrorCode(error) === 'already_fed') await sendFeed({ ...feed, extra: true }).catch(() => undefined);
        }
        sent += 1;
        await write((await read()).filter((item) => item.id !== feed.id));
        const photo = new File(feed.photoUri);
        if (photo.exists) photo.delete();
      }
    } finally {
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}
