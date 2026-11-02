import AsyncStorage from '@react-native-async-storage/async-storage';

import { SNAPSHOT_KEY, TOKEN_KEY, savedWidgetToken } from '@/features/widgets/data';
import { storedSession, supabase } from '@/lib/supabase';

// Apart from data.ts, which every background widget update loads: loading the Supabase client there
// would refresh the session of a phone nobody is using.
const OWNER_KEY = 'gozali.widget-token-owner';

/**
 * This device's widget token, created on first use while signed in. It belongs to the account it
 * was made for, and it must be the signed-in one's: a session the server ended leaves its token
 * behind, and the next account's widgets would go on showing the packs of the last. A token from
 * before owners were kept goes the same way, since nothing says whose it is.
 */
export async function widgetToken(): Promise<string | null> {
  const saved = await savedWidgetToken();
  if (!supabase) return saved;
  const [owner, session] = await Promise.all([AsyncStorage.getItem(OWNER_KEY), storedSession()]);
  const account = session?.user.id;
  if (saved && owner === account) return saved;
  if (saved) await forgetWidgetToken();
  if (!account) return null;
  const { data, error } = await supabase.rpc('create_widget_token');
  if (error) return null;
  await AsyncStorage.multiSet([
    [TOKEN_KEY, data],
    [OWNER_KEY, account],
  ]);
  return data;
}

/** On sign-out the token is revoked and the widgets forget everything. */
export async function forgetWidgetToken(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token && supabase) await supabase.rpc('revoke_widget_token', { token });
  await AsyncStorage.multiRemove([TOKEN_KEY, OWNER_KEY, SNAPSHOT_KEY]);
}
