import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { Critter } from '@/features/critter/Critter';
import { critterArt } from '@/features/critter/art';
import { packErrorKey, refreshJoinedPack, useJoinPack, usePackPreview } from '@/features/packs/api';
import { INVITE_CODE_LENGTH, categoryInfo, inviteCodeFrom, normalizeInviteCode } from '@/features/packs/constants';
import { notify } from '@/lib/confirm';
import { haptics } from '@/lib/haptics';
import { goBack } from '@/lib/navigation';
import { serverNow } from '@/lib/serverClock';
import { colors, radii, spacing } from '@/theme/tokens';

/** Join with a code, typed, pasted or arriving through gozali://join?code=... */
export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  // An invite link tapped with this screen open starts it over with its code.
  return <JoinForm key={code} linkCode={code ?? ''} />;
}

function JoinForm({ linkCode }: { linkCode: string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState(normalizeInviteCode(linkCode));
  const preview = usePackPreview(code);
  const joinPack = useJoinPack();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const body = useRef<ScrollView>(null);

  const onPaste = async () => {
    setCode(inviteCodeFrom(await Clipboard.getStringAsync()));
  };

  // Back to that pack if it is right underneath, so it isn't open twice. Anything else underneath
  // stays, or the way back through it and a photo on the camera would go.
  const openPack = (packId: string) => {
    // A second tap, or an answer arriving with another screen in front, moves nothing.
    if (!navigation.isFocused()) return;
    const under = navigation.getState()?.routes.at(-2);
    if (under?.name === 'pack/[id]/index' && (under.params as { id?: string })?.id === packId) router.back();
    else router.replace(`/pack/${packId}`);
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
      onError: (error) => notify(t(packErrorKey(error))),
    });
  };

  const pack = preview.data;
  const complete = code.length === INVITE_CODE_LENGTH;

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
          <AppText style={styles.error}>
            {t(packErrorKey(preview.error) === 'packs.errors.tooManyAttempts' ? 'packs.errors.tooManyAttempts' : 'errors.loadFailed')}
          </AppText>
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
  error: { color: colors.danger },
  actions: { gap: spacing.sm },
});
