import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase';

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

  const code = Linking.parse(result.url).queryParams?.code;
  if (typeof code !== 'string') throw new Error('The sign-in response had no code');
  const exchange = await auth.exchangeCodeForSession(code);
  if (exchange.error) throw exchange.error;
}

/** Native Sign in with Apple on iOS; Supabase verifies the identity token Apple returns. */
async function signInWithAppleNative(): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  });
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  const { error } = await requireSupabase().auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
}

export function signInWithApple(): Promise<void> {
  return Platform.OS === 'ios' ? signInWithAppleNative() : signInWithBrowser('apple');
}

/** The user closing Apple's sheet is not an error worth showing. */
export function isCancellation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
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

export async function signOut(): Promise<void> {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}
