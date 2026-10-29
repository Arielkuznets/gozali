import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';

// What a start without a connection needs to get to the packs and the camera (spec section 6):
// the profile and the packs. Everything else loads when the connection is back.
const KEPT = new Set(['profile', 'packs']);

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'gozali.query-cache' });

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  // A new version may shape its data differently.
  buster: Constants.expoConfig?.version ?? '',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => query.state.status === 'success' && KEPT.has(String(query.queryKey[0])),
  },
};

/** Forgets the kept copy: it belongs to the account that is leaving this phone. */
export async function forgetKeptQueries(): Promise<void> {
  await persister.removeClient();
}
