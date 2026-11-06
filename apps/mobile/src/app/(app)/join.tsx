import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { Critter } from '@/features/critter/Critter';
import { critterArt } from '@/features/critter/art';
import { packErrorKey, previewRefusal, refreshJoinedPack, useJoinPack, usePackPreview } from '@/features/packs/api';
import { INVITE_CODE_LENGTH, categoryInfo, inviteCodeFrom, normalizeInviteCode } from '@/features/packs/constants';
import { notify } from '@/lib/confirm';
import { haptics } from '@/lib/haptics';
import { goBack, useOpenPack } from '@/lib/navigation';
import { serverNow } from '@/lib/serverClock';
import { colors, radii, spacing } from '@/theme/tokens';

/** Join with a code, typed, pasted or arriving through gozali://join?code=... */
export default function JoinScreen() {
  // A link with the code in it more than once hands over a list.
  const { code } = useLocalSearchParams<{ code?: string | string[] }>();
  const linkCode = (Array.isArray(code) ? code[0] : code) ?? '';
  // An invite link tapped with this screen open starts it over with its code.
  return <JoinForm key={linkCode} linkCode={linkCode} />;
}

function JoinForm({ linkCode }: { linkCode: string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(normalizeInviteCode(linkCode));
  const preview = usePackPreview(code);
  const joinPack = useJoinPack();
  const openPack = useOpenPack();
  const queryClient = useQueryClient();
  const body = useRef<ScrollView>(null);

  // A paste the person refused reads as empty on iOS and throws on the web; either way the code they
  // typed stays.
  const onPaste = async () => {
    const pasted = inviteCodeFrom(await Clipboard.getStringAsync().catch(() => ''));
    if (pasted) setCode(pasted);
    else notify(t('join.nothingToPaste'));
  };

  const onOpen = (packId: string) => {
    refreshJoinedPack(queryClient, packId);
    openPack(packId);
  };

  const onJoin = () => {
    joinPack.mutate(code, {
      onSuccess: (packId) => {
        haptics.success();
        openPack(packId);
      },
      onError: (error) => {
        notify(t(packErrorKey(error)));
        // The pack shown may be out of date, as when the admin replaced the code since it loaded.
        void preview.refetch();
      },
    });
  };

  const pack = preview.data;
  const complete = code.length === INVITE_CODE_LENGTH;
  const refusal = preview.isError ? previewRefusal(preview.error) : null;

  return (
    <Screen>
      {/* Scrolls when the keyboard or a short window leaves too little room for the pack. What a code
          brings comes last, and has to show without a scroll: a code no pack has only dims the button. */}
      <ScrollView
        ref={body}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => body.current?.scrollToEnd()}>
        <AppText variant="heading">{t('join.title')}</AppText>
        <View style={styles.codeRow}>
          <View style={styles.codeField}>
            <TextField
              label={t('join.codeLabel')}
              placeholder={t('join.codePlaceholder')}
              autoCapitalize="characters"
              autoCorrect={false}
              // Latin keys whatever the phone's layout: a Hebrew one types letters no code has.
              keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : Platform.OS === 'android' ? 'visible-password' : undefined}
              value={code}
              onChangeText={(text) => setCode(inviteCodeFrom(text))}
              returnKeyType="join"
              onSubmitEditing={() => pack && !pack.is_full && onJoin()}
            />
          </View>
          {/* Wrapped so the button keeps its own height instead of stretching to the field and its label. */}
          <View>
            <Button label={t('join.paste')} variant="secondary" onPress={() => void onPaste()} />
          </View>
        </View>

        {complete && preview.isPending && <ActivityIndicator color={colors.accent} />}
        {complete && preview.isSuccess && pack === null && (
          <AppText style={styles.error}>{t('packs.errors.notFound')}</AppText>
        )}
        {complete && preview.isError && (
          <View style={styles.failed}>
            <AppText style={styles.error}>{t(refusal ?? 'errors.loadFailed')}</AppText>
            {/* Trying again can't change a refusal. */}
            {!refusal && (
              <Button
                label={t('home.retry')}
                variant="secondary"
                size="small"
                loading={preview.isFetching}
                onPress={() => void preview.refetch()}
              />
            )}
          </View>
        )}
        {pack && (
          <View style={styles.preview}>
            <Critter
              art={critterArt(pack.critter, { category: pack.category, now: serverNow() })}
              size={72}
              label={pack.critter.name ?? t(`packs.species.${pack.critter.species}`)}
              animated={false}
            />
            <View style={styles.previewText}>
              <AppText variant="heading">{pack.pack_name}</AppText>
              <AppText variant="caption">
                {categoryInfo(pack.category).emoji} {pack.custom_habit ?? t(`packs.categories.${pack.category}`)} ·{' '}
                {t('packs.members', { count: pack.member_count })}
              </AppText>
              {pack.member_names.length > 0 && (
                <AppText variant="caption" numberOfLines={2}>
                  {pack.member_names.join(', ')}
                </AppText>
              )}
              {pack.already_member && <AppText variant="caption">{t('join.alreadyMember')}</AppText>}
              {pack.is_full && !pack.already_member && (
                <AppText style={styles.error}>{t('packs.errors.full')}</AppText>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.actions}>
        {pack?.already_member ? (
          <Button label={t('join.open')} onPress={() => onOpen(pack.pack_id)} />
        ) : (
          <Button
            label={t('join.join')}
            disabled={!pack || pack.is_full}
            loading={joinPack.isPending}
            onPress={onJoin}
          />
        )}
        <Button label={t('join.back')} variant="secondary" onPress={() => goBack('/')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.md },
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
  failed: { gap: spacing.sm },
  error: { color: colors.danger },
  actions: { gap: spacing.sm },
});
