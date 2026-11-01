import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { feedErrorCode, isFinalRejection, isNetworkFailure, sendFeed, type OutgoingFeed } from '@/features/feeds/send';
import { isBlockedText } from '@/lib/errors';
import { storedSession } from '@/lib/supabase';

// Feeds that can't go out yet wait here until the app is open with a connection (spec section 6).
// The photo is copied into the app's documents so the system can't clear it meanwhile.
const STORAGE_KEY = 'gozali.feed-queue';

/** A waiting feed; stuckReported says the developer already heard that it can't go out. */
type QueuedFeed = OutgoingFeed & { stuckReported?: boolean };

/** A list that can't be read rejects: taken for empty, the next write would forget it. */
async function read(): Promise<QueuedFeed[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  try {
    return raw ? (JSON.parse(raw) as QueuedFeed[]) : [];
  } catch {
    // Nothing can ever read this value.
    return [];
  }
}

let lastChange: Promise<unknown> = Promise.resolve();

/** Changes to the list run one at a time, so none of them writes over what another just wrote. */
function inTurn<T>(change: () => Promise<T>): Promise<T> {
  const turn = lastChange.then(change);
  lastChange = turn.catch(() => undefined);
  return turn;
}

function update(change: (queue: QueuedFeed[]) => QueuedFeed[]): Promise<void> {
  return inTurn(async () => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(change(await read()))));
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
  try {
    await new File(feed.photoUri).copy(kept);
    await update((queue) => [...queue, { ...feed, photoUri: kept.uri }]);
  } catch (error) {
    // Most likely a full phone, where the next try needs the room.
    if (kept.exists) kept.delete();
    throw error;
  }
  return true;
}

/** Forgets what waits, photos included: they belong to an account that is leaving this phone. */
export async function clearQueue(): Promise<void> {
  await inTurn(() => AsyncStorage.removeItem(STORAGE_KEY));
  if (Platform.OS === 'web') return;
  const directory = new Directory(Paths.document, 'feed-queue');
  if (directory.exists) directory.delete();
}

/**
 * Forgets what other accounts left waiting, photos included. A session the server ended leaves its
 * feeds here for the same person to come back to, and nobody else can send them.
 */
export async function forgetFeedsOfOthers(userId: string): Promise<void> {
  const others = (await read()).filter((feed) => feed.userId !== userId);
  if (others.length === 0) return;
  await update((queue) => queue.filter((feed) => feed.userId === userId));
  for (const { id } of others) {
    const photo = new File(queueDirectory(), `${id}.jpg`);
    if (photo.exists) photo.delete();
  }
}

export async function pendingFeeds(packId?: string): Promise<OutgoingFeed[]> {
  const queue = await read();
  return packId ? queue.filter((feed) => feed.packId === packId) : queue;
}

/** What a run did, for the user and the developer to hear about. */
export type FlushResult = {
  /** Feeds that left the queue, the dropped ones included. */
  handled: number;
  /** Why each dropped feed won't go out. */
  dropped: unknown[];
  /** What stopped the queue, other than the network, the first time it stops on that. */
  stuck: unknown;
};

/** How a try at a feed ended. */
type Attempt = { outcome: 'sent' } | { outcome: 'dropped' | 'waiting'; error: unknown };

const PHOTO_GONE = new Error('queued_photo_gone');

let flushing: Promise<FlushResult> | null = null;
let storageFailureReported = false;

/** What can go out now: the server would turn down another account's feed for good. */
async function sendable(): Promise<QueuedFeed[]> {
  const userId = (await storedSession())?.user.id;
  return (await read()).filter((feed) => feed.userId === userId);
}

/**
 * The feed to send instead of one the server turned down for good, if there is one: fed from
 * another phone meanwhile, the photo still goes up as an extra post; and offline nobody checked
 * the caption, and nobody is there to fix it now, so the photo still feeds the pet without the
 * words the filter turned down.
 */
function replacement(feed: QueuedFeed, error: unknown): QueuedFeed | null {
  if (feedErrorCode(error) === 'already_fed' && !feed.extra) return { ...feed, extra: true };
  if (isBlockedText(error) && feed.caption !== null) return { ...feed, caption: null };
  return null;
}

/** Sends a feed, then its replacements. */
async function sendOrReplace(feed: QueuedFeed): Promise<Attempt> {
  try {
    await sendFeed(feed);
    return { outcome: 'sent' };
  } catch (error) {
    if (!isFinalRejection(error)) return { outcome: 'waiting', error };
    const next = replacement(feed, error);
    if (!next) return { outcome: 'dropped', error };
    // Kept as the replacement, so a later run doesn't meet the same refusal again.
    await update((queue) => queue.map((item) => (item.id === feed.id ? next : item)));
    return sendOrReplace(next);
  }
}

/**
 * Sends what the signed-in account has waiting, oldest first. A feed the server turns down for
 * good (already fed, or no longer a member) is dropped, except for its replacements above; so is
 * one whose photo is gone, since it can never go out and the ones behind it can. Any other error
 * stops the run and keeps the feed. The list is read again for each feed, so one queued meanwhile
 * goes out too, and nothing goes on after the queue was forgotten.
 */
async function run(): Promise<FlushResult> {
  const result: FlushResult = { handled: 0, dropped: [], stuck: null };
  try {
    for (let queue = await sendable(); queue.length > 0; queue = await sendable()) {
      const feed = queue[0];
      // By name, not by the stored path: iOS moves the app's folder when the app updates.
      const photo = new File(queueDirectory(), `${feed.id}.jpg`);
      const attempt: Attempt = photo.exists
        ? await sendOrReplace({ ...feed, photoUri: photo.uri })
        : { outcome: 'dropped', error: PHOTO_GONE };
      if (attempt.outcome === 'waiting') {
        // Kept on the feed, so the runs after the next start stay quiet about it too.
        if (!feed.stuckReported && !isNetworkFailure(attempt.error)) {
          await update((list) => list.map((item) => (item.id === feed.id ? { ...item, stuckReported: true } : item)));
          result.stuck = attempt.error;
        }
        break;
      }
      await update((list) => list.filter((item) => item.id !== feed.id));
      result.handled += 1;
      if (attempt.outcome === 'dropped') result.dropped.push(attempt.error);
      if (photo.exists) photo.delete();
    }
  } catch (error) {
    // The phone's storage failed. Nothing is lost, and the next run tries again. There is nowhere
    // to keep a note of this one, so it is reported once per start of the app.
    if (!storageFailureReported) result.stuck = error;
    storageFailureReported = true;
  }
  return result;
}

/**
 * Starts a run. Only the caller that started it hears what it did: coming back to the foreground
 * can start one twice over, and the user should hear about a dropped feed once.
 */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing.then(() => ({ handled: 0, dropped: [], stuck: null }));
  flushing = run().finally(() => {
    flushing = null;
  });
  return flushing;
}
