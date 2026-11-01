import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';

type QueryCache = typeof import('@/lib/queryCache');

// Who is signed in on this phone, as the stored session says.
let mockSignedIn: string | null;
jest.mock('@/lib/supabase', () => ({
  storedSession: async () => (mockSignedIn ? { user: { id: mockSignedIn } } : null),
}));

const COPY = 'gozali.query-cache';
const PACKS = [{ name: 'Gym squad' }];
/** Longer than the persister holds a save back after the one before it. */
const SAVE_MS = 1200;

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** The module as a start of the app finds it, with no save waiting. */
function afterRestart() {
  let module: QueryCache | undefined;
  jest.isolateModules(() => {
    module = jest.requireActual<QueryCache>('@/lib/queryCache');
  });
  return module!;
}

/** A query client saved to the copy on every change, as the app's provider does it. */
function appWithCopy({ persister, persistOptions }: QueryCache) {
  // No garbage collection, whose timers would outlive the test.
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  persistQueryClientSubscribe({ ...persistOptions, persister, queryClient });
  return queryClient;
}

/** Holds the next write back until the test lets it finish. */
function holdNextWrite() {
  const multiSet = jest.mocked(AsyncStorage.multiSet);
  const write = multiSet.getMockImplementation()!;
  let finish = () => {};
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const started = new Promise<void>((resolve) => {
    multiSet.mockImplementationOnce(async (pairs) => {
      resolve();
      await held;
      await write(pairs);
    });
  });
  return { started, finish };
}

/** What SIGNED_OUT does once auth-js has taken the session off the phone. */
async function signOut(queryClient: QueryClient, { forgetKeptQueries }: QueryCache) {
  mockSignedIn = null;
  queryClient.clear();
  await forgetKeptQueries();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSignedIn = 'noa';
});

describe('the copy kept on the phone', () => {
  it('stays gone when the account signs out while a save is held back', async () => {
    const cache = afterRestart();
    const queryClient = appWithCopy(cache);
    queryClient.setQueryData(['packs'], PACKS);
    await settle();

    await signOut(queryClient, cache);
    await settle(SAVE_MS);

    expect(await AsyncStorage.getItem(COPY)).toBeNull();
  });

  it('stays gone when the account signs out during the write', async () => {
    const cache = afterRestart();
    const queryClient = appWithCopy(cache);
    queryClient.setQueryData(['packs'], []);
    await settle(SAVE_MS);

    const write = holdNextWrite();
    queryClient.setQueryData(['packs'], PACKS);
    await write.started;
    await signOut(queryClient, cache);
    write.finish();
    await settle(SAVE_MS);

    expect(await AsyncStorage.getItem(COPY)).toBeNull();
  });

  it("doesn't hand a save held back to the next account", async () => {
    const cache = afterRestart();
    const queryClient = appWithCopy(cache);
    queryClient.setQueryData(['packs'], PACKS);
    await settle();

    await signOut(queryClient, cache);
    await settle();
    mockSignedIn = 'dan';
    await settle(SAVE_MS);

    expect((await AsyncStorage.getItem(COPY)) ?? '').not.toContain('Gym squad');
  });

  it('comes back for the account that wrote it', async () => {
    const queryClient = appWithCopy(afterRestart());
    queryClient.setQueryData(['packs'], PACKS);
    await settle(SAVE_MS);

    const restored = await afterRestart().persister.restoreClient();

    expect(restored?.clientState.queries.map((query) => query.state.data)).toEqual([PACKS]);
  });

  it('goes when another account finds it', async () => {
    const queryClient = appWithCopy(afterRestart());
    queryClient.setQueryData(['packs'], PACKS);
    await settle(SAVE_MS);

    mockSignedIn = 'dan';

    expect(await afterRestart().persister.restoreClient()).toBeUndefined();
    expect(await AsyncStorage.getItem(COPY)).toBeNull();
  });

  it('is not kept while nobody is signed in', async () => {
    mockSignedIn = null;
    const queryClient = appWithCopy(afterRestart());
    queryClient.setQueryData(['packs'], PACKS);
    await settle(SAVE_MS);

    expect(await AsyncStorage.getItem(COPY)).toBeNull();
  });
});
