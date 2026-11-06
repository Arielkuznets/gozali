import { LoadingScreen } from '@/components/ScreenStates';
import { useHomeRoute } from '@/features/profile/useProfile';
import { useLeaveFor } from '@/lib/navigation';

/**
 * Landing route for the sign-in deep link (gozali://auth/callback). The browser session hands the
 * code to the sign-in flow; if the link also reaches the router, just go back to the app.
 */
export default function AuthCallback() {
  useLeaveFor(useHomeRoute());
  return <LoadingScreen />;
}
