import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { AppState, Platform } from 'react-native';

import { forgetFeedsOf, forgetFeedsOfOthers } from '@/features/feeds/queue';
import { clearFocusSession } from '@/features/focus/session';
import { suggestName } from '@/features/profile/suggestedName';
import { clearWidgets, resumeWidgets } from '@/features/widgets/sync';
import { clearNotifications } from '@/lib/notifications';
import { unregisterPushToken } from '@/lib/push';
import { requireSupabase, storedSession } from '@/lib/supabase';

/** The deep link the browser returns to after Google or Apple (outside iOS). */
export const AUTH_CALLBACK_PATH = 'auth/callback';

/** Browser sign-in with PKCE: the app gets a one-time code back and trades it for a session. */
export async function signInWithBrowser(provider: 'google' | 'apple'): Promise<void> {
  const auth = requireSupabase().auth;
  const redirectTo = Linking.createURL(AUTH_CALLBACK_PATH);
  const { data, error } = await auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // closed by the user

  const params = Linking.parse(result.url).queryParams ?? {};
  if (typeof params.code !== 'string') throw callbackError(params);
  const exchange = await auth.exchangeCodeForSession(params.code);
  if (exchange.error) throw exchange.error;
}

/** The reason the auth server gives in the link when it sends the browser back without a code. */
function callbackError({ error, error_code, error_description }: Linking.QueryParams): Error {
  const reason = new Error(typeof error_description === 'string' ? error_description : 'The sign-in response had no code');
  const code = error_code ?? error;
  return typeof code === 'string' ? Object.assign(reason, { code }) : reason;
}

/**
 * Whether the Supabase project has Google sign-in turned on, from its public auth settings, so the
 * button shows only once it works and turning it on needs no new build. Unknown counts as off.
 */
export async function isGoogleEnabled(): Promise<boolean> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return false;
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
  if (!response.ok) return false;
  const settings = (await response.json()) as { external?: { google?: boolean } };
  return settings.external?.google === true;
}

/**
 * Native Sign in with Apple on iOS; Supabase verifies the identity token Apple returns. `onAnswered`
 * is called when Apple's part is over and only the server's is left.
 */
async function signInWithAppleNative(onAnswered: () => void): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  onAnswered();
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  // Apple sends the name only the first time, so the try after a failed one comes without it.
  const name = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
  if (name.trim()) suggestName(name);
  const { error } = await requireSupabase().auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
}

export function signInWithApple(onAnswered: () => void): Promise<void> {
  return Platform.OS === 'ios' ? signInWithAppleNative(onAnswered) : signInWithBrowser('apple');
}

/** The user closing Apple's sheet is not an error worth showing. */
export function isCancellation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
}

/** Less than this between the tap and a cancellation is quicker than anyone can close Apple's sheet. */
const SHEET_CLOSE_MS = 1000;

/** Long enough for Apple's sheet to be up, and in front of the app, if it is ever coming. */
export const NO_ANSWER_MS = 15_000;

/** How long a close of Apple's sheet gets to reach the app once the app reads active again. */
const CLOSE_ARRIVES_MS = 2000;

export type SignInTrouble = 'cancelled' | 'not-opened' | 'failed';

/**
 * What a sign-in that didn't finish means for the person who tapped: they closed Apple's sheet,
 * the sheet never opened (which can come back as a cancellation too, but sooner than a person
 * could cancel), or something else went wrong.
 */
export function signInTrouble(error: unknown, elapsedMs: number): SignInTrouble {
  if (!isCancellation(error)) return 'failed';
  return elapsedMs < SHEET_CLOSE_MS ? 'not-opened' : 'cancelled';
}

// Development only: a one-time email code, so the app can be used before Apple and Google are set up.
export async function sendDevCode(email: string): Promise<void> {
  const { error } = await requireSupabase().auth.signInWithOtp({ email });
  if (error) throw error;
}

export async function verifyDevCode(email: string, token: string): Promise<void> {
  const { error } = await requireSupabase().auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

/**
 * A fresh Apple authorization code, so the server can revoke Sign in with Apple as the account
 * goes (Apple asks for this). Only on iPhones and iPads, for people who signed in with Apple.
 * Closing Apple's sheet cancels the deletion; any other trouble, a sheet that never opened included,
 * lets it go on without the code. Apple can also stay silent for good, so the wait ends, but only
 * with the app active: otherwise someone may be on the sheet, about to close it, and a deletion
 * can't be taken back. The close can reach the app after the app reads active again, so the app has
 * to stay active for a moment before the wait ends.
 */
async function appleCodeForRevocation(): Promise<string | undefined> {
  if (Platform.OS !== 'ios') return undefined;
  const { data } = await requireSupabase().auth.getUser();
  const providers = (data.user?.app_metadata.providers as string[] | undefined) ?? [];
  if (!providers.includes('apple')) return undefined;
  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastLook: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<null>((resolve) => {
    timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      lastLook = setTimeout(() => AppState.currentState === 'active' && resolve(null), CLOSE_ARRIVES_MS);
    }, NO_ANSWER_MS);
  });
  try {
    const credential = await Promise.race([AppleAuthentication.signInAsync({ requestedScopes: [] }), silence]);
    return credential?.authorizationCode ?? undefined;
  } catch (error) {
    if (signInTrouble(error, Date.now() - started) === 'cancelled') throw error;
    return undefined;
  } finally {
    clearInterval(timer);
    clearTimeout(lastLook);
  }
}

/**
 * Whether the server no longer knows the account. A deletion's answer can be lost after the account
 * went, and from then on the function refuses it as nobody signed in.
 */
async function accountIsGone(): Promise<boolean> {
  const { error } = await requireSupabase().auth.getUser();
  return error?.code === 'user_not_found';
}

/**
 * Deletes the account and its data on the server (spec section 11), then forgets it here. With
 * `revokeApple` (app_config.apple_revocation), iPhone and iPad users who signed in with Apple
 * confirm with Apple first.
 */
export async function deleteAccount({ revokeApple }: { revokeApple: boolean }): Promise<void> {
  const supabase = requireSupabase();
  const leaving = (await storedSession())?.user.id;
  const appleAuthorizationCode = revokeApple ? await appleCodeForRevocation() : undefined;
  const { error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
    body: appleAuthorizationCode ? { appleAuthorizationCode } : {},
  });
  if (error && !(await accountIsGone())) throw error;
  // The server already removed the tokens with the account; this clears what the device keeps.
  await forgetTokens();
  await forgetAccountOnDevice(leaving);
  await supabase.auth.signOut({ scope: 'local' });
}

export async function signOut(): Promise<void> {
  const leaving = (await storedSession())?.user.id;
  const auth = requireSupabase().auth;
  // An expired session that can't be refreshed can't sign out either, so nothing is taken back yet.
  // A refresh the server refused goes on: that session is over.
  const { error: unreachable } = await auth.getSession();
  if (isAuthRetryableFetchError(unreachable)) throw unreachable;
  await forgetTokens();
  // This phone only, like the tokens forgotten above: other phones keep their session, so they
  // don't sit signed out while their pushes and widgets still come.
  const { error } = await auth.signOut({ scope: 'local' });
  if (error) {
    // Without a connection the server doesn't hear about it, but a session that loaded is gone
    // from this phone all the same. An expired one that couldn't be refreshed was never loaded, so
    // it is still stored: then getSession reports the same failure, and signing out didn't work.
    const current = await auth.getSession();
    if (current.data.session || current.error) {
      // Still signed in: the widgets carry on for this account.
      resumeWidgets();
      throw error;
    }
  }
  await forgetAccountOnDevice(leaving);
}

/** What the server keeps for this phone: it goes first, while there is a session to ask with. */
async function forgetTokens(): Promise<void> {
  await unregisterPushToken().catch(() => undefined);
  await clearWidgets().catch(() => undefined);
}

/** The account that last reached the app: the focus timer on this phone is its. */
const LAST_ACCOUNT_KEY = 'gozali.last-account';

/**
 * What the phone keeps for the account that is leaving, so the next one doesn't open its packs:
 * feeds still waiting to go out (without the session they can't, and their photos are the
 * account's), the focus timer, the notifications and the name from the sign-in provider. Only once
 * it is signed out, so a failed sign-out keeps them. An account that never reached the app has no
 * timer: the one here waits for the person who started it.
 */
async function forgetAccountOnDevice(userId: string | undefined): Promise<void> {
  suggestName(null);
  if (userId) await forgetFeedsOf(userId).catch(() => undefined);
  const last = await AsyncStorage.getItem(LAST_ACCOUNT_KEY).catch(() => null);
  if (!last || last === userId) await clearFocusSession().catch(() => undefined);
  await clearNotifications().catch(() => undefined);
}

/**
 * For each sign-in: what is on the phone from another account goes at once, as a tap on it would
 * open packs that aren't theirs.
 */
export async function forgetNotificationsOfOthers(userId: string): Promise<void> {
  const last = await AsyncStorage.getItem(LAST_ACCOUNT_KEY);
  if (last && last !== userId) await clearNotifications();
}

/**
 * A session the server ended leaves the feeds and the focus timer here, for the same person to come
 * back to. They go when another account reaches the app, and not sooner: one that signs in may be
 * the wrong Apple ID, and leave again from the profile setup. With no last account on record (a
 * phone from before there was one) what is here is taken to be this account's.
 */
export async function forgetOtherAccounts(userId: string): Promise<void> {
  await forgetFeedsOfOthers(userId).catch(() => undefined);
  const last = await AsyncStorage.getItem(LAST_ACCOUNT_KEY);
  if (last === userId) return;
  if (last) {
    await clearFocusSession().catch(() => undefined);
    await clearNotifications().catch(() => undefined);
  }
  await AsyncStorage.setItem(LAST_ACCOUNT_KEY, userId);
}
