import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';

/**
 * Back, or to `fallback` when there is nothing to go back to: a screen opened from a
 * notification, a widget or an invite link starts without a history.
 */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/**
 * Leaves a route that opens over whatever is on screen, once `href` is known. A screen already
 * open underneath is gone back to, with what was typed there, and only with nothing there does
 * `href` open: a Redirect would open a second copy over it.
 */
export function useLeaveFor(href: Href | null): void {
  useFocusEffect(
    useCallback(() => {
      if (href) goBack(href);
    }, [href]),
  );
}
