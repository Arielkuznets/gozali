import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { INVITE_CODE_LENGTH, normalizeInviteCode } from '@/features/packs/constants';

// Invite links (spec section 14): gozali.app/i/CODE opens the app when it's installed. Before
// install, Android passes the code through the Play Store referrer; on iOS the landing page
// copied it for pasting. A code that arrives before sign-in waits here until the home screen.
const PENDING_KEY = 'gozali.pending-invite';
const REFERRER_CHECKED_KEY = 'gozali.referrer-checked';

export async function savePendingInvite(code: string): Promise<void> {
  const clean = normalizeInviteCode(code);
  if (clean.length === INVITE_CODE_LENGTH) await AsyncStorage.setItem(PENDING_KEY, clean);
}

/** The waiting code, once: reading it clears it. */
export async function takePendingInvite(): Promise<string | null> {
  const code = await AsyncStorage.getItem(PENDING_KEY);
  if (code) await AsyncStorage.removeItem(PENDING_KEY);
  return code;
}

/** On the first start after installing from an invite on Android, keeps the code it carried. */
export async function readInstallReferrer(): Promise<void> {
  if (Platform.OS !== 'android' || (await AsyncStorage.getItem(REFERRER_CHECKED_KEY))) return;
  await AsyncStorage.setItem(REFERRER_CHECKED_KEY, '1');
  try {
    const referrer = await Application.getInstallReferrerAsync();
    const code = new URLSearchParams(referrer).get('code');
    if (code) await savePendingInvite(code);
  } catch {
    // Not installed from the Play Store (a development build): nothing to read.
  }
}
