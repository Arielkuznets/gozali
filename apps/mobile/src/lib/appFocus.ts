import { focusManager, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { onServerClockChange } from '@/lib/serverClock';

/**
 * TanStack Query hears about focus from the browser window; a phone has no window, so without
 * this, data went stale while the app sat in the background: who fed, and photo links that
 * expire after an hour. Coming back to the app now counts as focus, and stale queries refetch.
 *
 * Only from the background: iOS goes inactive and active again for Control Center, Notification
 * Center and system sheets, and on the way out when the side button locks the phone, and the app
 * never left. The first active of a start is no return either, unless the app wasn't in sight.
 *
 * The network side (onlineManager) stays off on purpose: it would pause requests while
 * offline instead of failing them, and the offline screen and the feed queue rely on failures.
 * A connection that comes back reloads the screen through useFeedQueue instead.
 */
export function refetchWhenAppReturns(): void {
  if (Platform.OS === 'web') return;
  focusManager.setEventListener((setFocused) => {
    if (AppState.currentState !== 'background') setFocused(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'inactive') setFocused(state === 'active');
    });
    return () => subscription.remove();
  });
}

/**
 * A query's age is read from the phone's clock, so what was fetched before that clock was set back
 * looks fresh for as long as the jump, and nothing asks for it again. The offset to the server's
 * clock moves when the phone's did, and then everything is read again. The widget refresh brings
 * that news on a return to the app, when nothing else may go out.
 */
export function useRefetchWhenClockMoves(): void {
  const queryClient = useQueryClient();
  useEffect(() => onServerClockChange(() => void queryClient.invalidateQueries()), [queryClient]);
}
