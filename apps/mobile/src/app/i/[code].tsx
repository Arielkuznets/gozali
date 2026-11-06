import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { LoadingScreen } from '@/components/ScreenStates';
import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/features/packs/constants';
import { savePendingInvite, takePendingInvite } from '@/features/packs/invites';
import { useHomeRoute } from '@/features/profile/useProfile';
import { useLeaveFor } from '@/lib/navigation';

/**
 * gozali.app/i/CODE and gozali://i/CODE. Signed in, the join screen opens with the code;
 * otherwise the code waits until sign-in and profile setup are done.
 */
export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const home = useHomeRoute();
  const [saved, setSaved] = useState(false);
  const ready = saved && home === '/';
  // With the app running this route opens over it; a link that starts the app has nothing under it.
  const overApp = ready && router.canGoBack();

  // A phone that refuses the code loses the link, not the way out of this route.
  useEffect(() => {
    void savePendingInvite(code)
      .catch(() => undefined)
      .finally(() => setSaved(true));
  }, [code]);

  useLeaveFor(saved && home !== '/' ? home : null);

  // Back to the app that is open, because a Redirect would build a second copy of it. Its home
  // screen opened long ago and won't read the code, so the code is taken here. A link with a code
  // of its own has no need for the phone to keep it, and a phone that refused has an older one.
  useEffect(() => {
    if (!overApp) return;
    void takePendingInvite()
      .catch(() => null)
      .then((pending) => {
        router.back();
        const link = normalizeInviteCode(code);
        const next = link.length === INVITE_CODE_LENGTH ? link : pending;
        if (next) router.navigate(`/join?code=${next}`);
      });
  }, [overApp, code]);

  // The home screen reads the saved code as it opens.
  if (ready && !overApp) return <Redirect href="/" />;
  return <LoadingScreen />;
}
