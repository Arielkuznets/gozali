import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { signOut } from '@/features/auth/signIn';
import { pendingFeeds } from '@/features/feeds/queue';
import { confirm, notify } from '@/lib/confirm';

/**
 * Sign out, for a screen that offers it. It deletes the feeds still waiting to go out and the only
 * copy of their photos, and the member was told those are safe, so then it asks first. A list that
 * can't be read can't be deleted either, so that goes ahead.
 */
export function useSignOut() {
  const { t } = useTranslation();
  // With an expired token signing out waits for the refresh to give up; meanwhile a tap would start it again.
  const leaving = useMutation({ mutationFn: signOut, onError: () => notify(t('errors.signOutFailed')) });
  const reading = useRef(false);

  const start = () => {
    if (reading.current) return;
    reading.current = true;
    void pendingFeeds()
      .catch(() => [])
      .then(({ length: count }) => {
        reading.current = false;
        if (count === 0) {
          leaving.mutate();
          return;
        }
        confirm({
          title: t('me.signOutTitle'),
          message: t('me.signOutWaiting', { count }),
          confirm: t('me.signOut'),
          cancel: t('settings.cancel'),
          destructive: true,
          onConfirm: () => leaving.mutate(),
        });
      });
  };

  return { isPending: leaving.isPending, start };
}
