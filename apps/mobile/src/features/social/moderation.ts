import { useTranslation } from 'react-i18next';

import type { Menu, MenuAction } from '@/components/ActionMenu';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBlock, useReport, useReportMember } from '@/features/social/api';
import { confirm } from '@/lib/confirm';

/**
 * Reporting and blocking, asked the same wherever a photo or a member is shown; their hooks give
 * the answer. `onBlocked` runs once a block is saved, for a screen still showing what the block just
 * hid, and `blocking` holds until the answer comes.
 */
export function useModeration(onBlocked?: () => void) {
  const { t } = useTranslation();
  const { session } = useAuth();
  // Only mutate, which stays the same: the whole result is new on every render, and every row of the
  // feed hangs on these menus. `blocking` is a plain value and leaves them alone.
  const { mutate: sendReport } = useReport();
  const { mutate: sendMemberReport } = useReportMember();
  const { mutate: sendBlock, isPending: blocking } = useBlock();
  const userId = session?.user.id;

  const reportFeed = (feedId: string, title: string, action: string) => {
    if (!userId) return;
    confirm({
      title,
      message: t('social.reportBody'),
      confirm: action,
      cancel: t('social.cancel'),
      destructive: true,
      onConfirm: () => sendReport({ feedId, reporterId: userId, reason: null }),
    });
  };

  const reportMember = (memberId: string, name: string) => {
    if (!userId) return;
    confirm({
      title: t('social.reportMemberTitle', { name }),
      message: t('social.reportMemberBody'),
      confirm: t('social.reportMember', { name }),
      cancel: t('social.cancel'),
      destructive: true,
      onConfirm: () => sendMemberReport({ memberId, reporterId: userId }),
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
      onConfirm: () => sendBlock({ blockerId: userId, blockedId: memberId }, { onSuccess: () => onBlocked?.() }),
    });
  };

  /** What the menu of someone else offers wherever they are listed. */
  const memberActions = (memberId: string, name: string): MenuAction[] => [
    { label: t('social.reportMember', { name }), onPress: () => reportMember(memberId, name) },
    { label: t('social.block', { name }), destructive: true, onPress: () => block(memberId, name) },
  ];

  /**
   * The menu of a photo someone else posted, with their own actions too: someone who left or was
   * removed has no circle left to press. Past its 30 days only a caption is left to report.
   */
  const photoMenu = (photo: { id: string; userId: string; name: string; url: string | null; caption: string | null }): Menu => {
    const action = t(photo.url ? 'social.report' : 'social.reportCaption');
    const title = t(photo.url ? 'social.reportTitle' : 'social.reportCaptionTitle');
    return {
      title: photo.name,
      actions: [
        ...(photo.url || photo.caption ? [{ label: action, onPress: () => reportFeed(photo.id, title, action) }] : []),
        ...memberActions(photo.userId, photo.name),
      ],
    };
  };

  return { memberActions, photoMenu, blocking };
}
