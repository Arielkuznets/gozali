import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase';

const TOKEN_KEY = 'gozali.push-token';

/** The EAS project id, present once the app is linked to an Expo project (eas init). */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

/**
 * Saves this device's push token for the user, when notifications are allowed. Quietly does
 * nothing on the web, in a simulator, or before the project is linked to EAS.
 */
export async function registerPushToken(userId: string): Promise<void> {
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
    const { error } = await requireSupabase()
      .from('push_tokens')
      .upsert({ token, user_id: userId, platform: Platform.OS === 'ios' ? 'ios' : 'android', updated_at: new Date().toISOString() });
    if (error) throw error;
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {
    // No token (simulator, no network): the next app start tries again.
  }
}

/** Forgets this device's token on sign-out, so the next person on it gets no pushes. */
export async function unregisterPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  await requireSupabase().from('push_tokens').delete().eq('token', token);
  await AsyncStorage.removeItem(TOKEN_KEY);
}
