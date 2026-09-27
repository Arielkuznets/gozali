import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { FOCUS_CHANNEL } from '@/lib/channels';

/**
 * A focus session (spec section 6). Times are wall-clock based, so the timer keeps going while
 * the app is in the background or closed, and a scheduled local notification marks the end.
 */
export type FocusSession = {
  packId: string;
  /** Planned length, or null for an open timer. */
  minutes: number | null;
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
  notificationId: string | null;
};

const STORAGE_KEY = 'gozali.focus';
export const FOCUS_LENGTHS = [15, 25, 45, 60] as const;

export function elapsedMs(session: FocusSession, now: number): number {
  return (session.pausedAt ?? now) - session.startedAt - session.pausedMs;
}

export function remainingMs(session: FocusSession, now: number): number | null {
  return session.minutes === null ? null : Math.max(0, session.minutes * 60_000 - elapsedMs(session, now));
}

/** Whole minutes to show on the feed, at least one. */
export function focusedMinutes(session: FocusSession, now: number): number {
  const minutes = Math.round(elapsedMs(session, now) / 60_000);
  return Math.max(1, session.minutes === null ? minutes : Math.min(minutes, session.minutes));
}

async function scheduleEnd(session: FocusSession, text: { title: string; body: string }): Promise<string | null> {
  const left = remainingMs(session, Date.now());
  if (Platform.OS === 'web' || left === null || session.minutes === null) return null;
  // Without the notification the timer still runs; the screen opens the camera if it's open.
  return Notifications.scheduleNotificationAsync({
    content: { ...text, data: { url: `/pack/${session.packId}/feed?focus=${session.minutes}` } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: Date.now() + left,
      channelId: FOCUS_CHANNEL,
    },
  }).catch(() => null);
}

async function cancelEnd(session: FocusSession | null) {
  if (session?.notificationId) {
    await Notifications.cancelScheduledNotificationAsync(session.notificationId).catch(() => undefined);
  }
}

async function save(session: FocusSession | null) {
  if (session) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Ends whatever session is stored, from outside the focus screen (the camera after a feed). */
export async function clearFocusSession(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  await cancelEnd(raw ? (JSON.parse(raw) as FocusSession) : null);
  await save(null);
}

/** The one running session (at most one at a time) and its controls. */
export function useFocusSession(text: { title: string; body: string }) {
  const [session, setSession] = useState<FocusSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      setSession(raw ? (JSON.parse(raw) as FocusSession) : null);
      setLoaded(true);
    });
  }, []);

  const update = useCallback(async (next: FocusSession | null) => {
    setSession(next);
    await save(next);
  }, []);

  const start = async (packId: string, minutes: number | null) => {
    await cancelEnd(session);
    const next: FocusSession = { packId, minutes, startedAt: Date.now(), pausedAt: null, pausedMs: 0, notificationId: null };
    await update({ ...next, notificationId: await scheduleEnd(next, text) });
  };

  const pause = async () => {
    if (!session || session.pausedAt !== null) return;
    await cancelEnd(session);
    await update({ ...session, pausedAt: Date.now(), notificationId: null });
  };

  const resume = async () => {
    if (!session || session.pausedAt === null) return;
    const next = { ...session, pausedMs: session.pausedMs + Date.now() - session.pausedAt, pausedAt: null };
    await update({ ...next, notificationId: await scheduleEnd(next, text) });
  };

  /** Ends the session; returns the minutes focused. */
  const stop = async (): Promise<number> => {
    const minutes = session ? focusedMinutes(session, Date.now()) : 0;
    await cancelEnd(session);
    await update(null);
    return minutes;
  };

  return { session, loaded, start, pause, resume, stop };
}
