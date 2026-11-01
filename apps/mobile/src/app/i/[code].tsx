import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { LoadingScreen } from '@/components/ScreenStates';
import { savePendingInvite } from '@/features/packs/invites';
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

  useEffect(() => {
    void savePendingInvite(code).then(() => setSaved(true));
  }, [code]);

  useLeaveFor(saved && home !== '/' ? home : null);

  // The home screen reads the saved code as it opens, so it opens anew.
  if (saved && home === '/') return <Redirect href="/" />;
  return <LoadingScreen />;
}
