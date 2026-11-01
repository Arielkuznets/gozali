import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { LoadingScreen } from '@/components/ScreenStates';
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

  useEffect(() => {
    void savePendingInvite(code).then(() => setSaved(true));
  }, [code]);

  useLeaveFor(saved && home !== '/' ? home : null);

  // Back to the app that is open, because a Redirect would build a second copy of it. Its home
  // screen opened long ago and won't read the code, so the code is taken here.
  useEffect(() => {
    if (!overApp) return;
    void takePendingInvite().then((pending) => {
      router.back();
      if (pending) router.navigate(`/join?code=${pending}`);
    });
  }, [overApp]);

  // The home screen reads the saved code as it opens.
  if (ready && !overApp) return <Redirect href="/" />;
  return <LoadingScreen />;
}
