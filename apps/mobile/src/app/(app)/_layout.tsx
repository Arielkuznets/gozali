import { Stack } from 'expo-router';

import { useFeedQueue } from '@/features/feeds/api';
import { colors } from '@/theme/tokens';

/** Screens for signed-in users with a finished profile. */
export default function AppLayout() {
  useFeedQueue();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="pack/[id]/feed" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}
