import { Stack } from 'expo-router';

import { useFeedQueue } from '@/features/feeds/api';
import { useAccountSync } from '@/features/profile/useProfile';
import { useWidgetSync } from '@/features/widgets/sync';
import { useNotificationRoutes } from '@/lib/notifications';
import { colors } from '@/theme/tokens';

// A screen opened from a notification, a widget or a link still has the home screen under it.
export const unstable_settings = { initialRouteName: 'index' };

/** Screens for signed-in users with a finished profile. */
export default function AppLayout() {
  useFeedQueue();
  useAccountSync();
  useWidgetSync();
  useNotificationRoutes();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="pack/[id]/feed" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="pack/[id]/not-today" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
