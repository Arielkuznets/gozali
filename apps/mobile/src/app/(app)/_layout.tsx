import { Stack } from 'expo-router';

import { colors } from '@/theme/tokens';

/** Screens for signed-in users with a finished profile. */
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
