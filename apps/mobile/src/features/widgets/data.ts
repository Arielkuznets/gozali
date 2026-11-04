import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WidgetPack } from '../../../../../supabase/functions/widget-state/state.ts';
import { clockedFetch } from '@/lib/serverClock';

/** What the widget-state endpoint returns; the widgets show exactly this. */
export type WidgetSnapshot = {
  timezone: string;
  fetchedAt: string;
  /**
   * When this phone got it, by its own clock: the only clock its age can be read from, as fetchedAt
   * is the server's. A copy from before this was noted has none.
   */
  savedAt?: number;
  packs: (WidgetPack & { imageUrl: string; nightImageUrl: string })[];
};

export const WIDGET_ENDPOINT = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/widget-state`;
/** Shared with the iOS widget target; must match app.json and targets/widget. */
export const APP_GROUP = 'group.app.gozali';

export const TOKEN_KEY = 'gozali.widget-token';
export const SNAPSHOT_KEY = 'gozali.widget-snapshot';

/** This device's widget token, if it has one. */
export function savedWidgetToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

/**
 * The state the widgets show, or null without an answer. The server forgets a token nobody used
 * for 90 days, and an account's tokens go with the account, which another phone can delete. This
 * device then forgets the token and the snapshot, so the widgets go blank and the app's next
 * refresh makes a new token. Kept, they left the widgets on the old picture for good.
 */
export async function fetchSnapshot(token: string): Promise<WidgetSnapshot | null> {
  try {
    const response = await clockedFetch(WIDGET_ENDPOINT, { headers: { 'x-widget-token': token } });
    if (response.status === 401 && (await response.text()) === 'unknown token') {
      await AsyncStorage.multiRemove([TOKEN_KEY, SNAPSHOT_KEY]);
      return null;
    }
    return response.ok ? { ...((await response.json()) as WidgetSnapshot), savedAt: Date.now() } : null;
  } catch {
    return null;
  }
}

export async function loadSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
  } catch {
    return null;
  }
}

export async function saveSnapshot(snapshot: WidgetSnapshot | null): Promise<void> {
  if (snapshot) await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  else await AsyncStorage.removeItem(SNAPSHOT_KEY);
}

/** The absolute address of a pack picture, from the relative one in the snapshot. */
export function imageAddress(relative: string): string {
  return new URL(relative, WIDGET_ENDPOINT).toString();
}
