import { ExtensionStorage } from '@bacons/apple-targets';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { updateAndroidWidgets } from '@/features/widgets/android/task';
import {
  APP_GROUP,
  WIDGET_ENDPOINT,
  fetchSnapshot,
  forgetWidgetToken,
  saveSnapshot,
  widgetToken,
  type WidgetSnapshot,
} from '@/features/widgets/data';

const shared = new ExtensionStorage(APP_GROUP);

/** Hands a snapshot to the widgets: the App Group on iOS, the widgets' own storage on Android. */
async function publish(snapshot: WidgetSnapshot | null, token: string | null): Promise<void> {
  await saveSnapshot(snapshot);
  if (Platform.OS === 'ios') {
    shared.set('snapshot', snapshot ? JSON.stringify(snapshot) : undefined);
    shared.set('token', token ?? undefined);
    shared.set('endpoint', WIDGET_ENDPOINT);
    ExtensionStorage.reloadWidget();
  } else if (Platform.OS === 'android') {
    await updateAndroidWidgets(snapshot);
  }
}

/** Fetches the widget state with this device's token and redraws the widgets. */
export async function refreshWidgets(): Promise<void> {
  if (Platform.OS === 'web') return;
  const token = await widgetToken(true);
  if (!token) return;
  const snapshot = await fetchSnapshot(token);
  if (snapshot) await publish(snapshot, token);
}

/** On sign-out the widgets go blank and the token stops working. */
export async function clearWidgets(): Promise<void> {
  if (Platform.OS === 'web') return;
  await forgetWidgetToken();
  await publish(null, null);
}

// What the widgets show: the critter and the members (packs), who fed (feeds) and who rests (days).
const WATCHED = new Set(['packs', 'feeds', 'days']);
const DEBOUNCE_MS = 3000;

/**
 * Keeps the widgets in step with the app (spec section 9: "right after every action"): after
 * any change to packs, feeds or passes, and whenever the app comes to the foreground.
 */
export function useWidgetSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshWidgets(), DEBOUNCE_MS);
    };
    schedule();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      // Fetches only: the app's own cache edits (a reaction shown before the server answers) change
      // nothing the widgets draw.
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        !event.action.manual &&
        WATCHED.has(String(event.query.queryKey[0]))
      ) {
        schedule();
      }
    });
    const appState = AppState.addEventListener('change', (state) => state === 'active' && schedule());
    return () => {
      clearTimeout(timer);
      unsubscribe();
      appState.remove();
    };
  }, [queryClient]);
}
