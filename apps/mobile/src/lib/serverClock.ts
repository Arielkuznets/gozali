import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// The server decides which day a feed counts for, so "today" on screen follows the server's clock:
// a phone set hours off would otherwise show the wrong countdown and "fed today". The offset comes
// from the Date header of the app's own requests. The header is cut to the second, so the estimate
// wobbles from answer to answer: under a minute off is left alone, as noise, and so is a move of
// under a minute. An answer that took long to come back can't say when it was sent, and neither
// can one that came back before it left, because the clock was set back meanwhile, so those aren't
// used. The web build (tests, store screenshots) keeps the browser's clock, which those set on
// purpose.
const IGNORED_MS = 60_000;
const SLOW_ANSWER_MS = 5_000;
const OFFSET_KEY = 'gozali.server-offset';

let offsetMs = 0;
const listeners = new Set<() => void>();

function setOffset(next: number): void {
  if (next === offsetMs) return;
  offsetMs = next;
  listeners.forEach((listener) => listener());
}

/**
 * Settles once the last run's offset is back. It is kept so a start without a connection still
 * stamps photos by the server's clock and judges the session by it.
 */
export const clockRestored: Promise<void> =
  Platform.OS === 'web'
    ? Promise.resolve()
    : AsyncStorage.getItem(OFFSET_KEY)
        .then((saved) => {
          if (saved !== null && offsetMs === 0) setOffset(Number(saved) || 0);
        })
        .catch(() => undefined);

/** Learns the server's time from a response's Date header, sent and received at the given times. */
export function noteServerDate(dateHeader: string | null, sentAt: number, receivedAt: number): void {
  if (Platform.OS === 'web' || Math.abs(receivedAt - sentAt) > SLOW_ANSWER_MS) return;
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  if (Number.isNaN(server)) return;
  const offset = server - (sentAt + receivedAt) / 2;
  if (Math.abs(offset - offsetMs) >= IGNORED_MS) setOffset(Math.abs(offset) < IGNORED_MS ? 0 : offset);
  void AsyncStorage.setItem(OFFSET_KEY, String(offsetMs)).catch(() => undefined);
}

/** Now, by the server's clock as far as this phone knows it. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** A time in seconds on the server's clock, as the phone's clock will show that moment. */
export function onPhoneClock(serverSeconds: number): number {
  return serverSeconds - Math.round(offsetMs / 1000);
}

/** Calls back whenever the known offset changes; returns the way to stop. */
export function onServerClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * How long a request waits for its answer to start. Nothing else ends one: the phones' network
 * clients have no time limit, so a connection that died quietly leaves a request open for as long
 * as the phone keeps the socket, and a token refresh left open holds back every request behind it.
 * The database ends a statement well before this, so an answer this late is one the connection
 * lost. A photo's answer comes after the whole photo went up, and a function can run for 150 s and
 * should get to say how it ended. The limit stops at the headers: cut off later, an empty body reads
 * as a good answer with no data.
 */
const ANSWER_LIMIT_MS = 30_000;
const LONG_ANSWER_LIMIT_MS = 160_000;

function answerLimit(input: unknown, init: RequestInit | undefined): number {
  const uploading = init?.body != null && typeof init.body !== 'string';
  return uploading || String(input).includes('/functions/v1/') ? LONG_ANSWER_LIMIT_MS : ANSWER_LIMIT_MS;
}

/** A fetch that notes the server's time from every answer and gives up on one that doesn't come. */
export const clockedFetch: typeof fetch = async (input, init) => {
  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), answerLimit(input, init));
  if (init?.signal?.aborted) limit.abort();
  init?.signal?.addEventListener('abort', () => limit.abort());
  const sentAt = Date.now();
  try {
    const response = await fetch(input, { ...init, signal: limit.signal });
    noteServerDate(response.headers.get('date'), sentAt, Date.now());
    return response;
  } finally {
    clearTimeout(timer);
  }
};
