import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WidgetPack } from '../../../../../supabase/functions/widget-state/state.ts';
import { supabase } from '@/lib/supabase';

/** What the widget-state endpoint returns; the widgets show exactly this. */
export type WidgetSnapshot = {
  timezone: string;
  fetchedAt: string;
  packs: (WidgetPack & { imageUrl: string; nightImageUrl: string })[];
};

export const WIDGET_ENDPOINT = `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/widget-state`;
/** Shared with the iOS widget target; must match app.json and targets/widget. */
export const APP_GROUP = 'group.app.gozali';

const TOKEN_KEY = 'gozali.widget-token';
const SNAPSHOT_KEY = 'gozali.widget-snapshot';

/** This device's widget token, created on first use while signed in. */
export async function widgetToken(create: boolean): Promise<string | null> {
  const saved = await AsyncStorage.getItem(TOKEN_KEY);
  if (saved || !create || !supabase) return saved;
  const { data, error } = await supabase.rpc('create_widget_token');
  if (error) return null;
  await AsyncStorage.setItem(TOKEN_KEY, data);
  return data;
}

/**
 * The state the widgets show, or null without an answer. The server forgets a token nobody used
 * for 90 days; this device forgets it then too, so the app's next refresh makes a new one. Kept,
 * it left the widgets on the old picture for good.
 */
export async function fetchSnapshot(token: string): Promise<WidgetSnapshot | null> {
  try {
    const response = await fetch(WIDGET_ENDPOINT, { headers: { 'x-widget-token': token } });
    if (response.status === 401 && (await response.text()) === 'unknown token') {
      await AsyncStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return response.ok ? ((await response.json()) as WidgetSnapshot) : null;
  } catch {
    return null;
  }
}

export async function loadSnapshot(): Promise<WidgetSnapshot | null> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  return raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
}

export async function saveSnapshot(snapshot: WidgetSnapshot | null): Promise<void> {
  if (snapshot) await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  else await AsyncStorage.removeItem(SNAPSHOT_KEY);
}

/** On sign-out the token is revoked and the widgets forget everything. */
export async function forgetWidgetToken(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token && supabase) await supabase.rpc('revoke_widget_token', { token });
  await AsyncStorage.multiRemove([TOKEN_KEY, SNAPSHOT_KEY]);
}

/** The absolute address of a pack picture, from the relative one in the snapshot. */
export function imageAddress(relative: string): string {
  return new URL(relative, WIDGET_ENDPOINT).toString();
}
