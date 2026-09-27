import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useAuth } from '@/features/auth/AuthProvider';
import { savePendingInvite } from '@/features/packs/invites';

/**
 * gozali.app/i/CODE and gozali://i/CODE. Signed in, the join screen opens with the code;
 * otherwise the code waits until sign-in and profile setup are done.
 */
export default function InviteLinkScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { session } = useAuth();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void savePendingInvite(code).then(() => setSaved(true));
  }, [code]);

  if (!saved) return null;
  return <Redirect href={session ? '/' : '/welcome'} />;
}
