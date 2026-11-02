import { Stack, type SingularOptions } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OfflineBanner } from '@/components/OfflineBanner';
import { useFeedQueue } from '@/features/feeds/api';
import { useAccountSync } from '@/features/profile/useProfile';
import { useWidgetSync } from '@/features/widgets/sync';
import { useNotificationRoutes } from '@/lib/notifications';
import { colors } from '@/theme/tokens';

export { ErrorScreen as ErrorBoundary } from '@/components/ErrorScreen';

// A screen opened from a notification, a widget or a link still has the home screen under it.
export const unstable_settings = { initialRouteName: 'index' };

/**
 * A screen holds what was done on it for its pack, such as a photo. A link that reused it would
 * carry that over to the link's pack, so a link to another pack opens that pack's own screen.
 */
const onePerPack: SingularOptions = (_name, params) => params.id as string;

/** Screens for signed-in users with a finished profile. */
export default function AppLayout() {
  useFeedQueue();
  useAccountSync();
  useWidgetSync();
  useNotificationRoutes();
  return (
    <View style={styles.fill}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        {/* First, because finishing the profile setup opens the first screen listed here. */}
        <Stack.Screen name="index" />
        <Stack.Screen name="pack/[id]/index" dangerouslySingular={onePerPack} />
        <Stack.Screen
          name="pack/[id]/feed"
          dangerouslySingular={onePerPack}
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="pack/[id]/not-today" options={{ presentation: 'modal' }} />
      </Stack>
      <OfflineBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
