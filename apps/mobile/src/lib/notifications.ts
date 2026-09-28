import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { FOCUS_CHANNEL } from '@/lib/channels';
import { registerPushToken } from '@/lib/push';

if (Platform.OS !== 'web') {
  // Show notifications while the app is open too.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Asks for permission when it can; true when notifications may be shown. */
export async function allowNotifications(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(FOCUS_CHANNEL, {
      name: 'Focus timer',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const granted = (await Notifications.requestPermissionsAsync()).granted;
  // The server needs this phone's token before it can send anything.
  if (granted) void registerPushToken();
  return granted;
}

export type NotificationPermission = 'granted' | 'ask' | 'blocked';

/**
 * Whether this phone lets the app notify: allowed, not asked yet (or asked and can ask again), or
 * turned off in the phone's settings. Checked again whenever the app comes back. Null on the web.
 */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const check = () => void readPermission().then(setPermission);
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => subscription.remove();
  }, []);

  const request = async () => {
    await allowNotifications();
    setPermission(await readPermission());
  };
  return { permission, request };
}

async function readPermission(): Promise<NotificationPermission> {
  const current = await Notifications.getPermissionsAsync();
  return current.granted ? 'granted' : current.canAskAgain ? 'ask' : 'blocked';
}

/** Opens the screen a tapped notification points to, from `data.url`. */
export function useNotificationRoutes() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (response: Notifications.NotificationResponse | null) => {
      const url: unknown = response?.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as Href);
    };
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      open(response);
      if (response) void Notifications.clearLastNotificationResponseAsync();
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, []);
}
