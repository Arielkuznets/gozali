import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export const FOCUS_CHANNEL = 'focus';

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
  return (await Notifications.requestPermissionsAsync()).granted;
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
