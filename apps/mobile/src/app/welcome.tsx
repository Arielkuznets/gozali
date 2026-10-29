import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LegalLinks } from '@/components/LegalLinks';
import { Screen } from '@/components/Screen';
import { useAppConfig } from '@/features/app/appConfig';
import { isGoogleEnabled, signInTrouble, signInWithApple, signInWithBrowser, type SignInTrouble } from '@/features/auth/signIn';
import { Critter } from '@/features/critter/Critter';
import { ONBOARDED_KEY } from '@/features/profile/onboarding';
import { notify } from '@/lib/confirm';
import { errorCode, reportSignInProblem } from '@/lib/reportError';
import { NotConfiguredError } from '@/lib/supabase';
import { critterColors, radii, spacing } from '@/theme/tokens';

type Provider = 'apple' | 'apple-web' | 'google';

const SIGN_IN: Record<Provider, () => Promise<void>> = {
  apple: signInWithApple,
  'apple-web': () => signInWithBrowser('apple'),
  google: () => signInWithBrowser('google'),
};

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<Provider | null>(null);
  const google = useQuery({ queryKey: ['google-sign-in'], queryFn: isGoogleEnabled, staleTime: Infinity });
  const config = useAppConfig();

  // The rules come first, once per install.
  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDED_KEY).then((done) => {
      if (!done) router.replace('/onboarding');
    });
  }, []);

  // A second tap while Apple's sheet is on its way would start a second request over the first.
  const pending = useRef(false);
  const [trouble, setTrouble] = useState<SignInTrouble | null>(null);
  // Apple's sign-in page, for a device where Apple's own sheet lets people down. It works once the
  // Apple provider is set up for the web, so the server turns it on (app_config.apple_web_sign_in).
  const [appleFailed, setAppleFailed] = useState(false);
  const offerAppleWeb = Platform.OS === 'ios' && appleFailed && config.data?.apple_web_sign_in === true;

  const run = async (provider: Provider) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(provider);
    setTrouble(null);
    const started = Date.now();
    try {
      await SIGN_IN[provider]();
    } catch (error) {
      // In development the log says what went wrong; the server hears about it either way.
      if (__DEV__) console.warn('Sign-in failed', error);
      reportSignInProblem(provider, error);
      if (provider === 'apple') setAppleFailed(true);
      const kind = signInTrouble(error, Date.now() - started);
      setTrouble(kind);
      const code = errorCode(error);
      const detail = code ? t('errors.code', { code }) : undefined;
      if (kind === 'not-opened') notify(t('welcome.appleDidntOpen'), detail);
      else if (kind === 'failed') {
        notify(error instanceof NotConfiguredError ? t('errors.notConfigured') : t('errors.signInFailed'), detail);
      }
    } finally {
      pending.current = false;
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
          // Apple requires its own button style for Sign in with Apple on iOS. It has no loading
          // state, so it dims while Apple's sheet is on its way.
          <View style={busy === 'apple' && styles.busy}>
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={radii.pill}
              style={styles.appleButton}
              onPress={() => void run('apple')}
            />
          </View>
        ) : (
          <Button label={t('welcome.continueWithApple')} loading={busy === 'apple'} onPress={() => void run('apple')} />
        )}
        {trouble === 'cancelled' && (
          <AppText variant="caption" style={styles.centerText}>
            {t('welcome.cancelled')}
          </AppText>
        )}
        {offerAppleWeb && (
          <Button
            label={t('welcome.appleInBrowser')}
            variant="secondary"
            loading={busy === 'apple-web'}
            onPress={() => void run('apple-web')}
          />
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
  busy: { opacity: 0.5, pointerEvents: 'none' },
  terms: { textAlign: 'center', marginTop: spacing.sm },
  centerText: { textAlign: 'center' },
});
