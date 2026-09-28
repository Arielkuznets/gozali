import { router, type Href } from 'expo-router';

/**
 * Back, or to `fallback` when there is nothing to go back to: a screen opened from a
 * notification, a widget or an invite link starts without a history.
 */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
