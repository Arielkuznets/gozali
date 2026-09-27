import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { Critter } from '@/features/critter/Critter';
import { packErrorKey, useJoinPack, usePackPreview } from '@/features/packs/api';
import { INVITE_CODE_LENGTH, categoryInfo, normalizeInviteCode } from '@/features/packs/constants';
import { colors, critterColors, radii, spacing } from '@/theme/tokens';

/** Join with a code, typed, pasted or arriving through gozali://join?code=... */
export default function JoinScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(normalizeInviteCode(params.code ?? ''));
  const preview = usePackPreview(code);
  const joinPack = useJoinPack();

  const onPaste = async () => {
    setCode(normalizeInviteCode(await Clipboard.getStringAsync()));
  };

  const onJoin = () => {
    joinPack.mutate(code, {
      onSuccess: (packId) => router.replace(`/pack/${packId}`),
      onError: (error) => Alert.alert(t(packErrorKey(error))),
    });
  };

  const pack = preview.data;
  const complete = code.length === INVITE_CODE_LENGTH;

  return (
    <Screen>
      <View style={styles.body}>
        <AppText variant="heading">{t('join.title')}</AppText>
        <View style={styles.codeRow}>
          <View style={styles.codeField}>
            <TextField
              label={t('join.codeLabel')}
              placeholder={t('join.codePlaceholder')}
              autoCapitalize="characters"
              autoCorrect={false}
              value={code}
              onChangeText={(text) => setCode(normalizeInviteCode(text))}
            />
          </View>
          <Button label={t('join.paste')} variant="secondary" onPress={() => void onPaste()} />
        </View>

        {complete && preview.isPending && <ActivityIndicator color={colors.accent} />}
        {complete && preview.isSuccess && pack === null && (
          <AppText style={styles.error}>{t('packs.errors.notFound')}</AppText>
        )}
        {pack && (
          <View style={styles.preview}>
            <Critter
              art={{ species: pack.species, color: critterColors[pack.color], stage: 'egg', look: 'egg' }}
              size={72}
              label={t(`packs.species.${pack.species}`)}
              animated={false}
            />
            <View style={styles.previewText}>
              <AppText variant="heading">{pack.pack_name}</AppText>
              <AppText variant="caption">
                {categoryInfo(pack.category).emoji} {pack.custom_habit ?? t(`packs.categories.${pack.category}`)} ·{' '}
                {t('packs.members', { count: pack.member_count })}
              </AppText>
              {pack.already_member && <AppText variant="caption">{t('join.alreadyMember')}</AppText>}
              {pack.is_full && !pack.already_member && (
                <AppText style={styles.error}>{t('packs.errors.full')}</AppText>
              )}
            </View>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        {pack?.already_member ? (
          <Button label={t('join.open')} onPress={() => router.replace(`/pack/${pack.pack_id}`)} />
        ) : (
          <Button
            label={t('join.join')}
            disabled={!pack || pack.is_full}
            loading={joinPack.isPending}
            onPress={onJoin}
          />
        )}
        <Button label={t('join.back')} variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  codeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  codeField: { flex: 1 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewText: { flex: 1, gap: 2 },
  error: { color: colors.danger },
  actions: { gap: spacing.sm },
});
