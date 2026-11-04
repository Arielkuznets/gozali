import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ActionMenu, type Menu } from '@/components/ActionMenu';
import { AppText } from '@/components/AppText';
import { initial } from '@/components/MemberCircles';
import { avatarCacheKey, pickAvatar, useAvatarUrls, useSetAvatar } from '@/features/profile/avatar';
import { useProfile } from '@/features/profile/useProfile';
import { confirm, notify } from '@/lib/confirm';
import { errorMessage } from '@/lib/errors';
import { colors, fonts, spacing } from '@/theme/tokens';

const SIZE = 88;

/**
 * The member's profile photo, or the first letter of their name, with a menu to take, choose or
 * remove a photo. `name` is the name as typed so far, for the letter.
 */
export function AvatarButton({ name }: { name: string | null | undefined }) {
  const { t } = useTranslation();
  const profile = useProfile();
  const path = profile.data?.avatar_path ?? null;
  const urls = useAvatarUrls([path]);
  const setAvatar = useSetAvatar();
  const [menu, setMenu] = useState<Menu | null>(null);
  const url = path ? urls.data?.get(path) : undefined;

  // One photo at a time: a second pick while the first uploads could land first and lose.
  const saving = setAvatar.isPending;

  const saveFailed = () => notify(t('errors.saveFailed'));
  // The promise, because mutate's callbacks are dropped once the screen closes, and the profile setup
  // closes on Continue while the photo may still be on its way.
  const save = (uri: string | null) => void setAvatar.mutateAsync(uri).catch(saveFailed);
  const cameraOff = () =>
    confirm({
      title: t('feed.permissionTitle'),
      message: t('me.cameraOff'),
      confirm: t('feed.openSettings'),
      cancel: t('social.cancel'),
      onConfirm: () => void Linking.openSettings(),
    });
  const pickFrom = (source: 'camera' | 'library') => () =>
    void pickAvatar(source).then(
      (uri) => uri && save(uri),
      (error: unknown) =>
        errorMessage(error) === 'camera_blocked' ? cameraOff() : notify(t(source === 'camera' ? 'me.cameraFailed' : 'me.libraryFailed')),
    );
  const open = () =>
    setMenu({
      title: t('me.photo'),
      actions: [
        { label: t('me.takePhoto'), onPress: pickFrom('camera') },
        { label: t('me.choosePhoto'), onPress: pickFrom('library') },
        ...(path ? [{ label: t('me.removePhoto'), destructive: true, onPress: () => save(null) }] : []),
      ],
    });

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('me.photo')}
        accessibilityState={{ disabled: saving, busy: saving }}
        disabled={saving}
        onPress={open}
        style={styles.wrap}>
        <View>
          {url ? (
            <Image source={{ uri: url, cacheKey: avatarCacheKey(url) }} style={styles.avatar} contentFit="cover" transition={200} />
          ) : (
            <View style={[styles.avatar, styles.empty]}>
              <AppText style={styles.initial}>{initial(name)}</AppText>
            </View>
          )}
          {saving && <ActivityIndicator style={[StyleSheet.absoluteFill, styles.saving]} color={colors.onDark} />}
        </View>
        <AppText variant="caption">{url ? t('me.changePhoto') : t('me.addPhoto')}</AppText>
      </Pressable>
      <ActionMenu menu={menu} cancel={t('social.cancel')} onClose={() => setMenu(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs, alignSelf: 'center' },
  avatar: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
  empty: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: fonts.heading, fontSize: 36, lineHeight: 44 },
  saving: { borderRadius: SIZE / 2, backgroundColor: 'rgba(59, 47, 42, 0.35)' },
});
