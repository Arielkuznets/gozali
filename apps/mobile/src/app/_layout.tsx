import '@/i18n';

import { Rubik_400Regular, Rubik_500Medium, Rubik_700Bold } from '@expo-google-fonts/rubik';
import { useFonts, VarelaRound_400Regular } from '@expo-google-fonts/varela-round';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { ErrorScreen } from '@/components/ErrorScreen';
import { UpdateRequired } from '@/components/UpdateRequired';
import { installedVersion, isOlder, useAppConfig } from '@/features/app/appConfig';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { readInstallReferrer } from '@/features/packs/invites';
import { isProfileComplete, useProfile } from '@/features/profile/useProfile';
import { refetchWhenAppReturns } from '@/lib/appFocus';
import { watchForCrashes } from '@/lib/reportError';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();
watchForCrashes();
refetchWhenAppReturns();

// A screen that throws while drawing shows this instead of a blank app.
export { ErrorScreen as ErrorBoundary };

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootNavigator() {
  const [fontsLoaded] = useFonts({ VarelaRound_400Regular, Rubik_400Regular, Rubik_500Medium, Rubik_700Bold });
  const { session, loading } = useAuth();
  const signedIn = session !== null;
  const profile = useProfile();
  const config = useAppConfig();
  const ready = fontsLoaded && !loading && (!signedIn || !profile.isPending);

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  useEffect(() => {
    void readInstallReferrer();
  }, []);

  if (!ready) return null;
  // A version the server no longer supports stops here, whoever is signed in.
  if (config.data && isOlder(installedVersion(), config.data.min_version)) {
    return <UpdateRequired storeUrl={Platform.OS === 'android' ? config.data.android_url : config.data.ios_url} />;
  }

  const profileComplete = isProfileComplete(profile.data);
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Protected guard={signedIn && profileComplete}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !profileComplete}>
        <Stack.Screen name="profile-setup" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="dev-login" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="i/[code]" />
    </Stack>
  );
}
