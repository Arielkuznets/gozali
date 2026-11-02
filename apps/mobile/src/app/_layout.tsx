import '@/i18n';

import { Rubik_400Regular, Rubik_500Medium, Rubik_700Bold } from '@expo-google-fonts/rubik';
import { useFonts, VarelaRound_400Regular } from '@expo-google-fonts/varela-round';
import { QueryClient, useMutation } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { ErrorScreen } from '@/components/ErrorScreen';
import { Screen } from '@/components/Screen';
import { LoadFailed, LoadingScreen } from '@/components/ScreenStates';
import { SignOutLink } from '@/components/SignOutLink';
import { UpdateRequired } from '@/components/UpdateRequired';
import { installedVersion, isOlder, useAppConfig } from '@/features/app/appConfig';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { signOut } from '@/features/auth/signIn';
import { readInstallReferrer } from '@/features/packs/invites';
import { isProfileComplete, useProfile, useSignedOutSync } from '@/features/profile/useProfile';
import { refetchWhenAppReturns, useRefetchWhenClockMoves } from '@/lib/appFocus';
import { notify } from '@/lib/confirm';
import { KEEP_MS, persistOptions } from '@/lib/queryCache';
import { watchForCrashes } from '@/lib/reportError';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();
watchForCrashes();
refetchWhenAppReturns();

// A screen that throws while drawing shows this instead of a blank app.
export { ErrorScreen as ErrorBoundary };

export default function RootLayout() {
  // Queries stay in memory as long as the copy kept on the phone, which holds only what is in memory.
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { gcTime: KEEP_MS } } }));
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

function RootNavigator() {
  const [fontsLoaded, fontError] = useFonts({ VarelaRound_400Regular, Rubik_400Regular, Rubik_500Medium, Rubik_700Bold });
  // A font that can't load falls back to the system font, which is no reason to keep the app shut.
  const fontsDone = fontsLoaded || fontError !== null;
  const { session, loading } = useAuth();
  const signedIn = session !== null;
  const profile = useProfile();
  const config = useAppConfig();
  useSignedOutSync();
  useRefetchWhenClockMoves();
  const ready = fontsDone && !loading && (!signedIn || !profile.isPending);

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  useEffect(() => {
    void readInstallReferrer();
  }, []);

  // Waiting for the profile again (trying it once more, or just after signing in) shows a
  // spinner; at the start the splash screen still covers it.
  if (!ready) return fontsDone && !loading ? <LoadingScreen /> : null;
  // A version the server no longer supports stops here, whoever is signed in.
  if (config.data && isOlder(installedVersion(), config.data.min_version)) {
    return <UpdateRequired storeUrl={Platform.OS === 'android' ? config.data.android_url : config.data.ios_url} />;
  }
  // A profile that didn't load (no connection at the start) is no reason to set it up again: the
  // profile setup loads it again on opening, and fails the same way.
  if (signedIn && profile.isError && !profile.data) {
    return <ProfileLoadFailed onRetry={() => void profile.refetch()} />;
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

/**
 * Nothing opens without the profile, so this is the only screen someone has: for an account deleted
 * elsewhere, whose profile will never load, until the token runs out.
 */
function ProfileLoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  // With an expired token signing out waits for the refresh to give up; meanwhile a tap would start it again.
  const leaving = useMutation({ mutationFn: signOut, onError: () => notify(t('errors.signOutFailed')) });
  return (
    <Screen>
      <SignOutLink leaving={leaving.isPending} onPress={() => leaving.mutate()} />
      <LoadFailed onRetry={onRetry} />
    </Screen>
  );
}
