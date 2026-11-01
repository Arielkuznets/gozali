import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase';

const TOKEN_KEY = 'gozali.push-token';
const REGISTERED_KEY = 'gozali.push-registered';
/** A token that left with its account, until the server has answered that it forgot it. */
const FORGET_KEY = 'gozali.push-forget';
/** The app comes to the foreground often; the server hears about the same token twice a day. */
const REFRESH_MS = 12 * 60 * 60 * 1000;

/** The latest forget. A register waits for its answer: arriving later, it would undo the register. */
let forgetting: Promise<void> = Promise.resolve();

/** The EAS project id, present once the app is linked to an Expo project (eas init). */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/**
 * Saves this device's push token for the user, when notifications are allowed. Quietly does
 * nothing on the web, in a simulator, or before the project is linked to EAS.
 */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  const id = projectId();
  if (!id) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Pack updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    if (!(await Notifications.getPermissionsAsync()).granted) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const { data: session } = await requireSupabase().auth.getSession();
    const stamp = `${session.session?.user.id ?? ''}:${token}`;
    const last = await AsyncStorage.getItem(REGISTERED_KEY);
    if (last && last.startsWith(`${stamp}@`) && Date.now() - Number(last.split('@')[1]) < REFRESH_MS) return;
    await forgetting;
    // Through a server function: the token may still belong to whoever used this phone before.
    const { error } = await requireSupabase().rpc('register_push_token', {
      device_token: token,
      device: Platform.OS === 'ios' ? 'ios' : 'android',
    });
    if (error) throw error;
    // The server holds it on purpose now, so no later try may take it away.
    await AsyncStorage.removeItem(FORGET_KEY);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(REGISTERED_KEY, `${stamp}@${Date.now()}`);
  } catch {
    // No token (simulator, no network): the next app start tries again.
  }
}

/** Whether the server answered that the token is gone. */
async function forgetOnServer(token: string): Promise<boolean> {
  const { error } = await requireSupabase().rpc('forget_push_token', { device_token: token });
  if (error?.code !== 'PGRST202') return !error;
  // A server without the function yet: only the account's own session can delete the row.
  const fallback = await requireSupabase().from('push_tokens').delete().eq('token', token);
  return !fallback.error;
}

async function forgetToken(): Promise<void> {
  try {
    const current = await AsyncStorage.getItem(TOKEN_KEY);
    if (current) {
      await AsyncStorage.setItem(FORGET_KEY, current);
      await AsyncStorage.multiRemove([TOKEN_KEY, REGISTERED_KEY]);
    }
    const token = await AsyncStorage.getItem(FORGET_KEY);
    if (token && (await forgetOnServer(token))) await AsyncStorage.removeItem(FORGET_KEY);
  } catch {
    // The token stays kept: the next start or return to the app tries again.
  }
}

/**
 * Forgets this device's token on sign-out, so the next person on it gets no pushes. A token the
 * server didn't answer for is kept, and goes with the next call (useSignedOutSync).
 */
export function unregisterPushToken(): Promise<void> {
  forgetting = forgetToken();
  return forgetting;
}
