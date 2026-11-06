import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { LegalLinks } from '@/components/LegalLinks';
import { Screen } from '@/components/Screen';
import { SignOutLink } from '@/components/SignOutLink';
import { useSignOut } from '@/features/auth/useSignOut';
import { AvatarButton } from '@/features/profile/AvatarButton';
import { suggestedName } from '@/features/profile/suggestedName';
import { NAME_MAX_LENGTH, useCompleteProfile, useProfile } from '@/features/profile/useProfile';
import { notify } from '@/lib/confirm';
import { isBlockedText } from '@/lib/errors';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  // The name from Apple or Google is only a suggestion. Apple sends it only the first time an Apple
  // ID signs in here, and App Review refuses a setup that then waits for a typed name, so without
  // one there is a default to keep or change. Cut by characters, as the server counts them: half of
  // an emoji can't be saved.
  const [name, setName] = useState(
    Array.from(profile?.display_name ?? suggestedName() ?? t('profileSetup.defaultName'))
      .slice(0, NAME_MAX_LENGTH)
      .join(''),
  );
  const [agreed, setAgreed] = useState(false);
  const completeProfile = useCompleteProfile();
  const leaving = useSignOut();

  const trimmed = name.trim();
  const canContinue = trimmed.length > 0 && agreed;

  const onContinue = () => {
    completeProfile.mutate(trimmed, {
      onError: (error) => notify(isBlockedText(error) ? t('errors.textNotAllowed') : t('errors.saveFailed')),
    });
  };

  return (
    <Screen>
      {/* The way out for a wrong Apple ID or terms someone won't accept: plain, and far from Continue. */}
      <SignOutLink leaving={leaving.isPending} disabled={completeProfile.isPending} onPress={leaving.start} />
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
        {/* The system asks as the home screen opens, right after this one (useAccountSync). It scrolls
            with the form, leaving the room above Continue to the form and the tick Continue waits for. */}
        <AppText variant="caption" style={styles.notice}>
          {t('profileSetup.notifications')}
        </AppText>
      </ScrollView>
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
  notice: { textAlign: 'center' },
});
