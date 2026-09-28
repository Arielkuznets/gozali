import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LegalLinks } from '@/components/LegalLinks';
import { Screen } from '@/components/Screen';
import { isCancellation, isGoogleEnabled, signInWithApple, signInWithBrowser } from '@/features/auth/signIn';
import { Critter } from '@/features/critter/Critter';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';
import { notify } from '@/lib/confirm';
import { NotConfiguredError } from '@/lib/supabase';
import { critterColors, radii, spacing } from '@/theme/tokens';

type Provider = 'apple' | 'google';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<Provider | null>(null);
  const google = useQuery({ queryKey: ['google-sign-in'], queryFn: isGoogleEnabled, staleTime: Infinity });

  // The rules come first, once per install.
  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDED_KEY).then((done) => {
      if (!done) router.replace('/onboarding');
    });
  }, []);

  const run = async (provider: Provider) => {
    setBusy(provider);
    try {
      await (provider === 'apple' ? signInWithApple() : signInWithBrowser('google'));
    } catch (error) {
      // The alert says little; in development the log says what went wrong.
      if (__DEV__) console.warn('Sign-in failed', error);
      if (!isCancellation(error)) {
        notify(error instanceof NotConfiguredError ? t('errors.notConfigured') : t('errors.signInFailed'));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <Critter
          art={{ species: 'mochi', color: critterColors.mochi, stage: 'kid', look: 'happy' }}
          size={180}
          label={t('welcome.critterLabel')}
        />
        <AppText variant="title">Gozali</AppText>
        <AppText style={styles.tagline}>{t('welcome.tagline')}</AppText>
      </View>

      <View style={styles.actions}>
        {Platform.OS === 'ios' ? (
          // Apple requires its own button style for Sign in with Apple on iOS.
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radii.pill}
            style={styles.appleButton}
            onPress={() => void run('apple')}
          />
        ) : (
          <Button label={t('welcome.continueWithApple')} loading={busy === 'apple'} onPress={() => void run('apple')} />
        )}
        {google.data === true && (
          <Button
            label={t('welcome.continueWithGoogle')}
            variant="secondary"
            loading={busy === 'google'}
            onPress={() => void run('google')}
          />
        )}
        {__DEV__ && (
          <Button label={t('welcome.devLogin')} variant="secondary" onPress={() => router.push('/dev-login')} />
        )}
        <AppText variant="caption" style={styles.terms}>
          {t('welcome.terms')}
        </AppText>
        <LegalLinks />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  tagline: { textAlign: 'center', maxWidth: 320 },
  actions: { gap: spacing.sm },
  appleButton: { height: 52, alignSelf: 'stretch' },
  terms: { textAlign: 'center', marginTop: spacing.sm },
});
