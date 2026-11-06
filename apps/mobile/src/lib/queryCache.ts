import { PAUSE_MAX_DAYS } from '@gozali/game-engine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { QueryKey } from '@tanstack/react-query';
import type { Persister, PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { storedSession } from '@/lib/supabase';

// What a start without a connection needs to get to the packs and the camera (spec section 6):
// the profile, the packs and who fed, so nobody is asked to feed twice. Everything else loads when
// the connection is back.
const KEPT = new Set(['profile', 'packs', 'feeds,counted']);

/** Kept by the first part of its key, or by all of it where the rest of that family isn't kept. */
const isKept = (key: QueryKey) => KEPT.has(String(key[0])) || KEPT.has(key.join());

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a query no screen uses stays in memory, and so in the copy, which holds only what is in
 * memory. Shorter than the copy lasts: setTimeout can't wait past about 24 days, and a longer time
 * would let go of the queries at once.
 */
export const KEEP_MS = 7 * DAY_MS;

/**
 * How long the copy is good for: the longest pause, so a start without a connection after reserve
 * duty or a trip with the app closed still gets to the packs and the camera.
 */
const COPY_MS = PAUSE_MAX_DAYS * DAY_MS;

const OWNER_KEY = 'gozali.query-cache-owner';

/**
 * Where the copy is written. The persister can hold a save back for a second, so the owner is
 * settled here, at the write, and with nobody signed in by then there is nothing to keep.
 */
const ownedStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: async (key: string, value: string) => {
    const owner = (await storedSession())?.user.id;
    if (!owner) return AsyncStorage.removeItem(key);
    await AsyncStorage.multiSet([
      [key, value],
      [OWNER_KEY, owner],
    ]);
  },
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

const stored = createAsyncStoragePersister({ storage: ownedStorage, key: 'gozali.query-cache' });

/**
 * The time a query in the copy comes back with when its own says nothing. Older than any screen,
 * and not 0: a query that already exists takes the copy's data only from a later time than its own.
 */
const LONG_AGO = 1;

/**
 * The copy belongs to the account signed in on this phone when it was written. It comes back
 * only for that account, so a sign-out the app never saw (the server refusing a refresh while
 * the app was closed) can't hand one account's packs to the next.
 *
 * Its times are the phone's clock of the run that saved it, and one later than now says that clock
 * was set back since. No answer of this run may show that, because Android's widget refresh can
 * learn it first with the app closed. Such a time would read as fresh for the size of the jump, and
 * as an answer that came after the screen opened, so it comes back as long ago.
 */
export const persister: Persister = {
  ...stored,
  restoreClient: async () => {
    const [owner, session] = await Promise.all([AsyncStorage.getItem(OWNER_KEY), storedSession()]);
    if (!session || owner !== session.user.id) {
      await stored.removeClient();
      return undefined;
    }
    const copy = await stored.restoreClient();
    const now = Date.now();
    copy?.clientState.queries.forEach(({ state }) => {
      if (state.dataUpdatedAt > now) state.dataUpdatedAt = LONG_AGO;
    });
    return copy;
  },
};

export const persistOptions: Omit<PersistQueryClientOptions, 'queryClient'> = {
  persister,
  maxAge: COPY_MS,
  // Each bundle may shape its data differently, and an EAS Update keeps the app's version.
  buster: Updates.updateId ?? Constants.expoConfig?.version ?? '',
  dehydrateOptions: {
    // A refetch that fails (offline) keeps its data, and so does the copy.
    shouldDehydrateQuery: (query) => query.state.data !== undefined && isKept(query.queryKey),
    // A mutation comes back without its function: it can never run, and its scope would wait for it.
    shouldDehydrateMutation: () => false,
  },
};

/** Forgets the kept copy: it belongs to the account that is leaving this phone. */
export async function forgetKeptQueries(): Promise<void> {
  await persister.removeClient();
}
