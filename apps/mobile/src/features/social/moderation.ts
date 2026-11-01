import { useTranslation } from 'react-i18next';

import type { Menu } from '@/components/ActionMenu';
import { useAuth } from '@/features/auth/AuthProvider';
import { socialErrorKey, useBlock, useReport } from '@/features/social/api';
import { confirm, notify } from '@/lib/confirm';

/**
 * Reporting and blocking, asked and answered the same wherever a photo or a member is shown.
 * `onBlocked` runs once a block is saved, for a screen still showing what the block just hid.
 */
export function useModeration(onBlocked?: () => void) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const report = useReport();
  const blockMember = useBlock();
  const userId = session?.user.id;
  const fail = (error: unknown) => notify(t(socialErrorKey(error)));

  const reportPhoto = (feedId: string) => {
    if (!userId) return;
    confirm({
      title: t('social.reportTitle'),
      message: t('social.reportBody'),
      confirm: t('social.report'),
      cancel: t('social.cancel'),
      destructive: true,
      onConfirm: () =>
        report.mutate(
          { feedId, reporterId: userId, reason: null },
          { onSuccess: () => notify(t('social.reported')), onError: fail },
        ),
    });
  };

  const block = (memberId: string, name: string) => {
    if (!userId) return;
    confirm({
      title: t('social.blockTitle', { name }),
      message: t('social.blockBody'),
      confirm: t('social.block', { name }),
      cancel: t('social.cancel'),
      destructive: true,
      onConfirm: () =>
        blockMember.mutate(
          { blockerId: userId, blockedId: memberId },
          {
            onSuccess: () => {
              onBlocked?.();
              notify(t('social.blockedLeave'));
            },
            onError: fail,
          },
        ),
    });
  };

  /** The menu of a photo someone else posted. */
  const photoMenu = (photo: { id: string; userId: string; name: string }): Menu => ({
    title: photo.name,
    actions: [
      { label: t('social.report'), onPress: () => reportPhoto(photo.id) },
      { label: t('social.block', { name: photo.name }), destructive: true, onPress: () => block(photo.userId, photo.name) },
    ],
  });

  return { block, photoMenu };
}
