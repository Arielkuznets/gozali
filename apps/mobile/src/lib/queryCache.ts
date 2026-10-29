import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Persister, PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { storedSession } from '@/lib/supabase';

// What a start without a connection needs to get to the packs and the camera (spec section 6):
// the profile and the packs. Everything else loads when the connection is back.
const KEPT = new Set(['profile', 'packs']);

/** How long the kept copy is good for; queries stay in memory as long, so the copy has them. */
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const OWNER_KEY = 'gozali.query-cache-owner';
const stored = createAsyncStoragePersister({ storage: AsyncStorage, key: 'gozali.query-cache' });

/**
 * The copy belongs to the account signed in on this phone when it was written. It comes back
 * only for that account, so a sign-out the app never saw (the server refusing a refresh while
 * the app was closed) can't hand one account's packs to the next.
 */
export const persister: Persister = {
  persistClient: async (client) => {
    const owner = (await storedSession())?.user.id;
    if (!owner) return stored.removeClient();
    await AsyncStorage.setItem(OWNER_KEY, owner);
    return stored.persistClient(client);
  },
  restoreClient: async () => {
    const [owner, session] = await Promise.all([AsyncStorage.getItem(OWNER_KEY), storedSession()]);
    if (!session || owner !== session.user.id) {
      await stored.removeClient();
      return undefined;
    }
    return stored.restoreClient();
  },
  removeClient: () => stored.removeClient(),
};

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: KEEP_MS,
  // Each bundle may shape its data differently, and an EAS Update keeps the app's version.
  buster: Updates.updateId ?? Constants.expoConfig?.version ?? '',
  dehydrateOptions: {
    // A refetch that fails (offline) keeps its data, and so does the copy.
    shouldDehydrateQuery: (query) => query.state.data !== undefined && KEPT.has(String(query.queryKey[0])),
  },
};

/** Forgets the kept copy: it belongs to the account that is leaving this phone. */
export async function forgetKeptQueries(): Promise<void> {
  await persister.removeClient();
}
