import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { sendDevCode, verifyDevCode } from '@/features/auth/signIn';
import { notify } from '@/lib/confirm';
import { NotConfiguredError } from '@/lib/supabase';
import { goBack } from '@/lib/navigation';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

/** Development builds only: sign in with an email code before Apple and Google are configured. */
export default function DevLoginScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const attempt = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(error instanceof NotConfiguredError ? t('errors.notConfigured') : t('errors.signInFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.form}>
        <AppText variant="heading">{t('devLogin.title')}</AppText>
        <TextInput
          style={styles.input}
          placeholder={t('devLogin.email')}
          placeholderTextColor={colors.inkMuted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        {codeSent && (
          <TextInput
            style={styles.input}
            placeholder={t('devLogin.code')}
            placeholderTextColor={colors.inkMuted}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            value={code}
            onChangeText={setCode}
          />
        )}
        {codeSent ? (
          <Button
            label={t('devLogin.logIn')}
            loading={busy}
            disabled={code.trim().length === 0}
            onPress={() => void attempt(() => verifyDevCode(email.trim(), code.trim()))}
          />
        ) : (
          <Button
            label={t('devLogin.sendCode')}
            loading={busy}
            disabled={email.trim().length === 0}
            onPress={() => void attempt(async () => {
              await sendDevCode(email.trim());
              setCodeSent(true);
            })}
          />
        )}
        <Button label={t('devLogin.back')} variant="secondary" onPress={() => goBack('/welcome')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, justifyContent: 'center', gap: spacing.md },
  input: {
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
});
