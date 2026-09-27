import { focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

/**
 * TanStack Query hears about focus from the browser window; a phone has no window, so without
 * this, data went stale while the app sat in the background: who fed, and photo links that
 * expire after an hour. Coming back to the app now counts as focus, and stale queries refetch.
 *
 * The network side (onlineManager) stays off on purpose: it would pause requests while
 * offline instead of failing them, and the offline screen and the feed queue rely on failures.
 */
export function refetchWhenAppReturns(): void {
  if (Platform.OS === 'web') return;
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => setFocused(state === 'active'));
    return () => subscription.remove();
  });
}
