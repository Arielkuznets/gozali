import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionMenu, type Menu } from '@/components/ActionMenu';
import { AppText } from '@/components/AppText';
import { pickAvatar, useAvatarUrls, useSetAvatar } from '@/features/profile/avatar';
import { useProfile } from '@/features/profile/useProfile';
import { notify } from '@/lib/confirm';
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

  const saveFailed = () => notify(t('errors.saveFailed'));
  const pickFrom = (source: 'camera' | 'library') => () =>
    void pickAvatar(source).then((uri) => uri && setAvatar.mutate(uri, { onError: saveFailed }));
  const open = () =>
    setMenu({
      title: t('me.photo'),
      actions: [
        { label: t('me.takePhoto'), onPress: pickFrom('camera') },
        { label: t('me.choosePhoto'), onPress: pickFrom('library') },
        ...(path ? [{ label: t('me.removePhoto'), destructive: true, onPress: () => setAvatar.mutate(null, { onError: saveFailed }) }] : []),
      ],
    });

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('me.photo')} onPress={open} style={styles.wrap}>
        {url ? (
          <Image source={{ uri: url }} style={styles.avatar} contentFit="cover" transition={200} />
        ) : (
          <View style={[styles.avatar, styles.empty]}>
            <AppText style={styles.initial}>{(name?.trim()[0] ?? '?').toUpperCase()}</AppText>
          </View>
        )}
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
});
