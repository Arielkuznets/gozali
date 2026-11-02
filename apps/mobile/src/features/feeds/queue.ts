import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { AppState, Platform } from 'react-native';

import { feedErrorCode, inTime, isFinalRejection, isNetworkFailure, sendFeed, type OutgoingFeed } from '@/features/feeds/send';
import { isBlockedText } from '@/lib/errors';
import { errorText } from '@/lib/reportError';
import { storedSession } from '@/lib/supabase';

// Feeds that can't go out yet wait here until the app is open with a connection (spec section 6).
// The photo is copied into the app's documents so the system can't clear it meanwhile.
const STORAGE_KEY = 'gozali.feed-queue';

/**
 * A waiting feed; stuckReported says the developer already heard that it can't go out. One with
 * droppedFor waits for nothing any more: it stays only for the member to hear why it was dropped.
 */
type QueuedFeed = OutgoingFeed & { stuckReported?: boolean; droppedFor?: string };

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

/** Unknown counts as a connection: the request itself will find out. */
export function hasConnection(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export async function isOnline(): Promise<boolean> {
  return hasConnection(await NetInfo.fetch());
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
 * Clears what the camera and the compressor leave in the cache folder, a full-size photo per shot,
 * which the system clears only when the phone runs out of room. Only for the start of the app,
 * before any screen: later it would take the file a send is reading. A waiting feed has its own
 * copy in the documents, and both libraries make their folder again for the next photo.
 */
export function clearShotFiles(): void {
  if (Platform.OS === 'web') return;
  for (const name of ['Camera', 'ImageManipulator']) {
    try {
      const directory = new Directory(Paths.cache, name);
      if (directory.exists) directory.delete();
    } catch {
      // Still there at the next start, which does no harm.
    }
  }
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
  const queue = (await read()).filter((feed) => !feed.droppedFor);
  return packId ? queue.filter((feed) => feed.packId === packId) : queue;
}

/** What a run did, for the user and the developer to hear about. */
export type FlushResult = {
  /** Feeds that left the queue, the dropped ones included. */
  handled: number;
  /** Why each dropped feed won't go out, for all that nobody heard about yet. */
  dropped: string[];
  /** What keeps a feed waiting, other than the network, the first time that feed stops on it. */
  stuck: unknown[];
};

/** How a try at a feed ended. */
type Attempt = { outcome: 'sent' } | { outcome: 'dropped' | 'waiting'; error: unknown };

const PHOTO_GONE = new Error('queued_photo_gone');

let flushing: Promise<FlushResult> | null = null;
let storageFailureReported = false;

/** What can go out now: the server would turn down another account's feed for good. */
async function sendable(): Promise<QueuedFeed[]> {
  const userId = (await storedSession())?.user.id;
  return (await read()).filter((feed) => feed.userId === userId && !feed.droppedFor);
}

/**
 * Takes the signed-in account's dropped feeds off the list and says why each went. They wait there
 * because the member has to hear of a drop that is already done: the app can be killed before the
 * run ends, and Android loses an alert made while the app is paused.
 */
async function takeDropped(): Promise<string[]> {
  const userId = (await storedSession())?.user.id;
  return inTurn(async () => {
    const queue = await read();
    const dropped = queue.filter((feed) => feed.droppedFor && feed.userId === userId);
    if (dropped.length === 0) return [];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue.filter((feed) => !dropped.includes(feed))));
    return dropped.map((feed) => feed.droppedFor ?? '');
  });
}

/**
 * The feed to send instead of one the server turned down for good, if there is one: fed from
 * another phone meanwhile, the photo still goes up as an extra post, and an extra the server took
 * for the day's feed gets the same one retry; and offline nobody checked the caption, and nobody
 * is there to fix it now, so the photo still feeds the pet without the words the filter turned down.
 */
function replacement(feed: QueuedFeed, error: unknown, retried: boolean): QueuedFeed | null {
  if (feedErrorCode(error) === 'already_fed' && !retried) return { ...feed, extra: true };
  if (isBlockedText(error) && feed.caption !== null) return { ...feed, caption: null };
  return null;
}

/** Sends a feed, then its replacements. */
async function sendOrReplace(feed: QueuedFeed, retried = false): Promise<Attempt> {
  try {
    await inTime((givenUp) => sendFeed(feed, givenUp));
    return { outcome: 'sent' };
  } catch (error) {
    if (!isFinalRejection(error)) return { outcome: 'waiting', error };
    const next = replacement(feed, error, retried);
    if (!next) return { outcome: 'dropped', error };
    // Kept as the replacement, so a later run doesn't meet the same refusal again.
    await update((queue) => queue.map((item) => (item.id === feed.id ? next : item)));
    return sendOrReplace(next, retried || feedErrorCode(error) === 'already_fed');
  }
}

/**
 * Sends what the signed-in account has waiting, oldest first. A feed the server turns down for
 * good (already fed, or no longer a member) is dropped, except for its replacements above; so is
 * one whose photo left the phone, since it can never go out and the ones behind it can. No answer
 * from the server stops the run and keeps the feed, as the ones behind it would meet the same. Any
 * other error keeps the feed for the next run and goes on: it may be that one photo that can't be
 * read, and the server takes feeds in any order. The list is read again for each feed, so one
 * queued meanwhile goes out too, and nothing goes on after the queue was forgotten. Drops are told
 * at the end of a run with the app in front, this run's and what earlier ones left.
 */
async function run(): Promise<FlushResult> {
  const result: FlushResult = { handled: 0, dropped: [], stuck: [] };
  const passed = new Set<string>();
  const untried = async () => (await sendable()).filter((feed) => !passed.has(feed.id));
  try {
    for (let queue = await untried(); queue.length > 0; queue = await untried()) {
      const feed = queue[0];
      // By name, not by the stored path: iOS moves the app's folder when the app updates.
      const photo = new File(queueDirectory(), `${feed.id}.jpg`);
      const attempt: Attempt = photo.exists
        ? await sendOrReplace({ ...feed, photoUri: photo.uri })
        : { outcome: 'dropped', error: PHOTO_GONE };
      if (attempt.outcome === 'waiting') {
        if (isNetworkFailure(attempt.error)) break;
        passed.add(feed.id);
        // Kept on the feed, so the runs after the next start stay quiet about it too. Not offline,
        // where the report goes nowhere and the note would silence the one that could arrive.
        if (!feed.stuckReported && (await isOnline())) {
          await update((list) => list.map((item) => (item.id === feed.id ? { ...item, stuckReported: true } : item)));
          result.stuck.push(attempt.error);
        }
        continue;
      }
      if (attempt.outcome === 'dropped') {
        const droppedFor = errorText(attempt.error);
        await update((list) => list.map((item) => (item.id === feed.id ? { ...item, droppedFor } : item)));
      } else {
        await update((list) => list.filter((item) => item.id !== feed.id));
      }
      result.handled += 1;
      if (photo.exists) photo.delete();
    }
    if (AppState.currentState === 'active') result.dropped = await takeDropped();
  } catch (error) {
    // The phone's storage failed. Nothing is lost, and the next run tries again. There is nowhere
    // to keep a note of this one, so it is reported once per start of the app, with a connection.
    if (!storageFailureReported && (await isOnline())) {
      result.stuck.push(error);
      storageFailureReported = true;
    }
  }
  return result;
}

/**
 * Starts a run. Only the caller that started it hears what it did: coming back to the foreground
 * can start one twice over, and the user should hear about a dropped feed once.
 */
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing.then(() => ({ handled: 0, dropped: [], stuck: [] }));
  flushing = run().finally(() => {
    flushing = null;
  });
  return flushing;
}
