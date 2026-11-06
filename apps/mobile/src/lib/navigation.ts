import { router, useFocusEffect, useNavigation, type Href } from 'expo-router';
import { useCallback } from 'react';

/**
 * For a push of a route that is one per pack, which opens a new screen as any push does. The rule
 * is there for links. A push that went by it would pull a copy from under other screens to the
 * top, which the native stack can't be trusted with when one of them is a modal.
 */
export const NEW_SCREEN = { dangerouslySingular: () => undefined };

/**
 * Back, or to `fallback` when there is nothing to go back to: a screen opened from a
 * notification, a widget or an invite link starts without a history.
 */
export function goBack(fallback: Href = '/'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

const isPack = (route: { name: string; params?: object } | undefined, packId: string) =>
  route?.name === 'pack/[id]/index' && (route.params as { id?: string } | undefined)?.id === packId;

/**
 * Swaps the screen in front for a pack. Back to that pack if it is right underneath, so it isn't
 * open twice. Anything else underneath stays, or the way back through it and a photo on the camera
 * would go. A second tap, or an answer arriving with another screen in front, moves nothing.
 */
export function useOpenPack(): (packId: string) => void {
  const navigation = useNavigation();
  return useCallback(
    (packId) => {
      if (!navigation.isFocused()) return;
      if (isPack(navigation.getState()?.routes.at(-2), packId)) router.back();
      else router.replace(`/pack/${packId}`);
    },
    [navigation],
  );
}

/**
 * Back to the pack a screen was opened from, past what stands between them, or to that pack in its
 * place when it isn't underneath. dismissTo goes to the lowest copy of a pack, past a camera left
 * under a second copy.
 */
export function useBackToPack(): (packId: string) => void {
  const navigation = useNavigation();
  return (packId) => {
    const routes = navigation.getState()?.routes ?? [];
    const pack = routes.findLastIndex((route) => isPack(route, packId));
    if (pack === -1) router.replace(`/pack/${packId}`);
    else router.dismiss(routes.length - 1 - pack);
  };
}

/**
 * For a screen with nothing left to show: down to the home screen, or no further than a camera left
 * underneath, whose photo would go with no word.
 */
export function useBackHome(): () => void {
  const navigation = useNavigation();
  return useCallback(() => {
    const under = navigation.getState()?.routes.slice(0, -1) ?? [];
    const camera = under.findLastIndex((route) => route.name === 'pack/[id]/feed');
    if (camera === -1) router.dismissTo('/');
    else router.dismiss(under.length - camera);
  }, [navigation]);
}

/** A screen's navigation, which hands an action to the stack the screen is on. */
type ScreenNavigation = { dispatch(action: { type: string; payload?: object }): void };

/** Screens that ask before they close, such as a camera with a photo that hasn't gone out. */
const asking = new Set<ScreenNavigation>();

/** Counts the screen of `navigation` as one that asks, until the function it returns is called. */
export function askBeforeLinks(navigation: ScreenNavigation): () => void {
  asking.add(navigation);
  return () => void asking.delete(navigation);
}

const PACK_LINK = /^gozali:\/\/pack\/([^/?#]+)(\/feed)?\/?$/;

/**
 * The router follows a link by handing the app's stack new params, and the stack then drops the
 * screens over the one the link opens with no beforeRemove. While a screen asks, the widgets' links
 * (a pack and its camera) go to the stack as the same NAVIGATE instead, which does ask it. True
 * when the link went that way.
 */
export function followPackLink(url: string): boolean {
  const [navigation] = asking;
  const link = PACK_LINK.exec(url);
  if (!navigation || !link) return false;
  navigation.dispatch({
    type: 'NAVIGATE',
    payload: { name: link[2] ? 'pack/[id]/feed' : 'pack/[id]/index', params: { id: link[1] }, pop: true },
  });
  return true;
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
