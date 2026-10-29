import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { feedErrorCode, isFinalRejection, sendFeed, type OutgoingFeed } from '@/features/feeds/send';
import { isBlockedText } from '@/lib/errors';

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

/** Forgets what waits, photos included: they belong to an account that is leaving this phone. */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  if (Platform.OS === 'web') return;
  const directory = new Directory(Paths.document, 'feed-queue');
  if (directory.exists) directory.delete();
}

export async function pendingFeeds(packId?: string): Promise<OutgoingFeed[]> {
  const queue = await read();
  return packId ? queue.filter((feed) => feed.packId === packId) : queue;
}

let flushing: Promise<number> | null = null;

/**
 * The feed to send instead of one the server turned down for good, if there is one: fed from
 * another phone meanwhile, the photo still goes up as an extra post; and offline nobody checked
 * the caption, and nobody is there to fix it now, so the photo still feeds the pet without the
 * words the filter turned down.
 */
function replacement(feed: OutgoingFeed, error: unknown): OutgoingFeed | null {
  if (feedErrorCode(error) === 'already_fed' && !feed.extra) return { ...feed, extra: true };
  if (isBlockedText(error) && feed.caption !== null) return { ...feed, caption: null };
  return null;
}

/** Sends a feed, then its replacements; false when a network error means it has to wait. */
async function sendOrReplace(feed: OutgoingFeed): Promise<boolean> {
  try {
    await sendFeed(feed);
    return true;
  } catch (error) {
    if (!isFinalRejection(error)) return false;
    const next = replacement(feed, error);
    if (!next) return true;
    // Kept as the replacement, so a later run doesn't meet the same refusal again.
    await write((await read()).map((item) => (item.id === feed.id ? next : item)));
    return sendOrReplace(next);
  }
}

/**
 * Sends what is waiting, oldest first; returns how many were handled. A feed the server turns
 * down for good (already fed, or no longer a member) is dropped, except for its replacements
 * above; a network error stops the run and keeps the feed.
 */
export function flushQueue(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      for (const feed of await read()) {
        if (!(await sendOrReplace(feed))) break;
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
