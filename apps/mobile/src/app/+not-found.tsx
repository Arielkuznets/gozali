import { LoadingScreen } from '@/components/ScreenStates';
import { useHomeRoute } from '@/features/profile/useProfile';
import { useLeaveFor } from '@/lib/navigation';

/** A link the app has no screen for, such as gozali.app/i/ without a code: back to the app. */
export default function NotFound() {
  useLeaveFor(useHomeRoute());
  return <LoadingScreen />;
}
