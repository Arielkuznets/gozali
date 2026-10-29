import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// The server decides which day a feed counts for, so "today" on screen follows the server's clock:
// a phone set hours off would otherwise show the wrong countdown and "fed today". The offset comes
// from the Date header of the app's own requests. Under a minute off is left alone, as noise; an
// answer that took long to come back can't say when it was sent, so it isn't used. The web build
// (tests, store screenshots) keeps the browser's clock, which those set on purpose.
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

// The last offset is kept, so a start without a connection still stamps photos by the server's clock.
if (Platform.OS !== 'web') {
  void AsyncStorage.getItem(OFFSET_KEY)
    .then((saved) => {
      if (saved !== null && offsetMs === 0) setOffset(Number(saved) || 0);
    })
    .catch(() => undefined);
}

/** Learns the server's time from a response's Date header, sent and received at the given times. */
export function noteServerDate(dateHeader: string | null, sentAt: number, receivedAt: number): void {
  if (Platform.OS === 'web' || receivedAt - sentAt > SLOW_ANSWER_MS) return;
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  if (Number.isNaN(server)) return;
  const offset = server - (sentAt + receivedAt) / 2;
  setOffset(Math.abs(offset) < IGNORED_MS ? 0 : offset);
  void AsyncStorage.setItem(OFFSET_KEY, String(offsetMs)).catch(() => undefined);
}

/** Now, by the server's clock as far as this phone knows it. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** Calls back whenever the known offset changes; returns the way to stop. */
export function onServerClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A fetch that notes the server's time from every answer. */
export const clockedFetch: typeof fetch = async (input, init) => {
  const sentAt = Date.now();
  const response = await fetch(input, init);
  noteServerDate(response.headers.get('date'), sentAt, Date.now());
  return response;
};
