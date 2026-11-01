import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LegalLinks } from '@/components/LegalLinks';
import { Screen } from '@/components/Screen';
import { signOut } from '@/features/auth/signIn';
import { AvatarButton } from '@/features/profile/AvatarButton';
import { suggestedName } from '@/features/profile/suggestedName';
import { NAME_MAX_LENGTH, useCompleteProfile, useProfile } from '@/features/profile/useProfile';
import { notify } from '@/lib/confirm';
import { isBlockedText } from '@/lib/errors';
import { allowNotifications } from '@/lib/notifications';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  // The name from Apple or Google is only a suggestion.
  const [name, setName] = useState((profile?.display_name ?? suggestedName() ?? '').slice(0, NAME_MAX_LENGTH));
  const [agreed, setAgreed] = useState(false);
  const completeProfile = useCompleteProfile();
  // With an expired token signing out waits for the refresh to give up; meanwhile a tap would start it again.
  const leaving = useMutation({ mutationFn: signOut, onError: () => notify(t('errors.signOutFailed')) });
  const busy = leaving.isPending || completeProfile.isPending;

  const trimmed = name.trim();
  const canContinue = trimmed.length > 0 && agreed;

  const onContinue = () => {
    completeProfile.mutate(trimmed, {
      // The system asks once; the line above the button says why.
      onSuccess: () => void allowNotifications(),
      onError: (error) => notify(isBlockedText(error) ? t('errors.textNotAllowed') : t('errors.saveFailed')),
    });
  };

  return (
    <Screen>
      {/* The way out for a wrong Apple ID or terms someone won't accept: plain, and far from Continue. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy: leaving.isPending }}
        disabled={busy}
        onPress={() => leaving.mutate()}
        hitSlop={8}
        style={styles.signOut}>
        {leaving.isPending && <ActivityIndicator color={colors.inkMuted} />}
        <AppText variant="caption">{t('me.signOut')}</AppText>
      </Pressable>
      {/* Scrolls when the keyboard leaves too little room, instead of the lines running into each other. */}
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <AppText variant="heading">{t('profileSetup.title')}</AppText>
        <AvatarButton name={name} />
        <View style={styles.field}>
          <AppText variant="caption" aria-hidden>
            {t('profileSetup.nameLabel')}
          </AppText>
          <TextInput
            style={styles.input}
            accessibilityLabel={t('profileSetup.nameLabel')}
            placeholder={t('profileSetup.namePlaceholder')}
            placeholderTextColor={colors.inkMuted}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="name"
            value={name}
            onChangeText={setName}
          />
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((value) => !value)}
          style={styles.agreeRow}>
          <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
            {agreed && <AppText style={styles.checkmark}>✓</AppText>}
          </View>
          <AppText style={styles.agreeText}>{t('profileSetup.agree')}</AppText>
        </Pressable>
        <LegalLinks />
      </ScrollView>
      <AppText variant="caption" style={styles.notice}>
        {t('profileSetup.notifications')}
      </AppText>
      <Button
        label={t('profileSetup.continue')}
        disabled={!canContinue || leaving.isPending}
        loading={completeProfile.isPending}
        onPress={onContinue}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: spacing.sm, minHeight: 44 },
  form: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.md },
  field: { gap: spacing.xs },
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
  agreeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: colors.onAccent, fontFamily: fonts.bodyBold },
  agreeText: { flex: 1 },
  notice: { textAlign: 'center', paddingBottom: spacing.md },
});
