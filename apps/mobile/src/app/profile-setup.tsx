import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { NAME_MAX_LENGTH, useCompleteProfile, useProfile } from '@/features/profile/useProfile';
import { allowNotifications } from '@/lib/notifications';
import { colors, fonts, radii, spacing } from '@/theme/tokens';

export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const { data: profile } = useProfile();
  // The name from Apple or Google is only a suggestion.
  const [name, setName] = useState(profile?.display_name ?? '');
  const [agreed, setAgreed] = useState(false);
  const completeProfile = useCompleteProfile();

  const trimmed = name.trim();
  const canContinue = trimmed.length > 0 && agreed;

  const onContinue = () => {
    completeProfile.mutate(trimmed, {
      // The system asks once; the line above the button says why.
      onSuccess: () => void allowNotifications(),
      onError: () => Alert.alert(t('errors.saveFailed')),
    });
  };

  return (
    <Screen>
      <View style={styles.form}>
        <AppText variant="heading">{t('profileSetup.title')}</AppText>
        <View style={styles.field}>
          <AppText variant="caption">{t('profileSetup.nameLabel')}</AppText>
          <TextInput
            style={styles.input}
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
      </View>
      <AppText variant="caption" style={styles.notice}>
        {t('profileSetup.notifications')}
      </AppText>
      <Button
        label={t('profileSetup.continue')}
        disabled={!canContinue}
        loading={completeProfile.isPending}
        onPress={onContinue}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, justifyContent: 'center', gap: spacing.lg },
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
