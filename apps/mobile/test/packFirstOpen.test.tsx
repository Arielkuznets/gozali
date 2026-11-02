import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import FeedScreen from '@/app/(app)/pack/[id]/feed';
import { useMilestone, type Milestone, type Seen } from '@/features/critter/milestones';
import { useDayStatus } from '@/features/days/api';
import { packsKey, usePack, type Pack } from '@/features/packs/api';

type QueryCache = typeof import('@/lib/queryCache');

// The real hooks on a real QueryClient, over a stand-in for the server whose answers the tests can
// hold back. What the pack's own read answers:
let mockAnswer: () => Promise<{ data: unknown; error: unknown }>;
let mockReads = 0;
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  storedSession: async () => ({ user: { id: 'noa' } }),
  requireSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            mockReads += 1;
            return mockAnswer();
          },
        }),
      }),
    }),
    rpc: (name: string, args: unknown) => mockRpc(name, args),
  }),
}));

// The real permission hook, over what the system answers.
const mockGet = jest.fn();
const mockRequest = jest.fn();
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.requireActual('expo-modules-core').createPermissionHook({
    getMethod: () => mockGet(),
    requestMethod: () => mockRequest(),
  }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
const mockId = 'gym-squad';
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: mockId }),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
  useFocusEffect: jest.fn(),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
jest.mock('@/features/feeds/api', () => ({ useSendFeed: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/features/feeds/send', () => ({ compressPhoto: jest.fn(), isFinalRejection: () => false }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: jest.fn() }));

const ID = mockId;
const SEEN_KEY = `gozali.seen.${ID}`;
const COPY = 'gozali.query-cache';
const EGG: Seen = { status: 'egg', stage: 'egg' };
const BABY: Seen = { status: 'active', stage: 'baby' };
const KID: Seen = { status: 'active', stage: 'kid' };
const LIST_STAMP = 1_000_000;
/** Well past the second the persister holds a save back after the one before it. */
const SAVE_MS = 1500;
const OFFLINE = { data: null, error: new TypeError('Network request failed') };
jest.setTimeout(15_000);

const entry = (critters: Seen, name = 'From the list'): Pack =>
  ({ id: ID, name, timezone: 'Asia/Jerusalem', critters, pack_members: [] }) as unknown as Pack;
const never = () => new Promise<never>(() => undefined);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = (ms = 20) => act(() => wait(ms));
const remembered = async () => JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? 'null') as Seen | null;
const remember = (seen: Seen) => AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));

/** Holds the pack's own read until `answer` is called. */
function holdAnswer() {
  let answer = (_: unknown) => {};
  mockAnswer = () =>
    new Promise((resolve) => {
      answer = (data) => resolve({ data, error: null });
    });
  return async (data: unknown) => {
    await act(async () => answer(data));
    await settle();
  };
}

// No garbage collection, whose timers would outlive the test.
function newClient() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
}

function clientWithList(list: Pack[], updatedAt = LIST_STAMP) {
  const client = newClient();
  client.setQueryData(packsKey, list, { updatedAt });
  return client;
}

type Render = { name: string | undefined; pending: boolean; error: boolean; data: unknown; at: number; milestone: Milestone | null };
const trees: ReactTestRenderer[] = [];
let renders: Render[];
const record = (render: Render) => renders.push(render);
const milestone = () => renders.at(-1)?.milestone;

function PackScreen({ id = ID }: { id?: string }) {
  const { data, dataUpdatedAt, isPending, isError } = usePack(id);
  const moment = useMilestone(data?.id, data?.critters, dataUpdatedAt);
  record({ name: data?.name, pending: isPending, error: isError, data, at: dataUpdatedAt, milestone: moment.milestone });
  return null;
}

async function open(client: QueryClient, id = ID) {
  await act(async () => {
    trees.push(
      create(
        <QueryClientProvider client={client}>
          <PackScreen id={id} />
        </QueryClientProvider>,
      ),
    );
  });
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  renders = [];
  mockReads = 0;
  mockAnswer = never;
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: { day: '2099-01-01', pause: null }, error: null });
  mockGet.mockReset();
  mockRequest.mockReset();
});

afterEach(async () => {
  await act(async () => {
    for (const tree of trees.splice(0)) tree.unmount();
  });
});

describe('a pack in the list with no entry of its own', () => {
  it('is on screen from the first render, and is still asked for', async () => {
    const client = clientWithList([entry(BABY)]);
    await open(client);

    expect(renders[0]).toMatchObject({ name: 'From the list', pending: false });
    expect(mockReads).toBe(1);
    expect(client.getQueryState(['packs', ID])?.fetchStatus).toBe('fetching');
  });

  it('carries the time of the list', async () => {
    const client = clientWithList([entry(BABY)]);
    await open(client);

    expect(renders[0]?.at).toBe(LIST_STAMP);
    expect(client.getQueryState(['packs', ID])?.dataUpdatedAt).toBe(LIST_STAMP);
  });

  it('stays on screen when the read fails', async () => {
    mockAnswer = async () => OFFLINE;
    await open(clientWithList([entry(BABY)]));

    expect(renders.at(-1)).toMatchObject({ name: 'From the list', pending: false, error: true });
  });

  it('gives way to the answer', async () => {
    mockAnswer = async () => ({ data: entry(BABY, 'From the server'), error: null });
    await open(clientWithList([entry(BABY)]));

    expect(renders.at(-1)).toMatchObject({ name: 'From the server', pending: false });
    expect(mockReads).toBe(1);
  });

  it('goes once the server says the pack is gone, and the list does not bring it back', async () => {
    mockAnswer = async () => ({ data: null, error: null });
    const client = clientWithList([entry(BABY)]);
    await open(client);
    expect(renders.at(-1)?.data).toBeNull();

    await act(async () => trees.pop()?.unmount());
    renders = [];
    mockAnswer = never;
    await open(client);

    expect(renders[0]?.data).toBeNull();
  });

  it('starts the day status at once, in one request', async () => {
    function Status() {
      useDayStatus(ID);
      return null;
    }
    await act(async () => {
      trees.push(
        create(
          <QueryClientProvider client={clientWithList([entry(BABY)])}>
            <Status />
          </QueryClientProvider>,
        ),
      );
    });
    await settle();

    expect(mockRpc.mock.calls).toEqual([['my_day_status', { target: ID }]]);
  });
});

describe('what a pack opened from the list does to the milestone', () => {
  // The first render happens in the millisecond the screen opens, so an entry stamped at its making
  // would pass for what the server answered since then.
  async function openWithClockStopped(client: QueryClient) {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      await open(client);
    } finally {
      clock.mockRestore();
    }
  }

  it('waits for the server before it celebrates', async () => {
    await remember(BABY);
    const answer = holdAnswer();
    await openWithClockStopped(clientWithList([entry(KID)]));
    expect(renders.at(-1)).toMatchObject({ name: 'From the list', pending: false });
    expect(milestone()).toBeNull();
    expect(await remembered()).toEqual(BABY);

    await answer(entry(KID));

    expect(milestone()).toEqual({ kind: 'evolved', to: 'kid' });
  });

  it('remembers nothing from a list behind what this phone already celebrated', async () => {
    await remember(BABY);
    const answer = holdAnswer();
    await openWithClockStopped(clientWithList([entry(EGG)]));
    expect(renders.at(-1)).toMatchObject({ name: 'From the list', pending: false });
    expect(await remembered()).toEqual(BABY);

    await answer(entry(BABY));

    expect(milestone()).toBeNull();
    expect(await remembered()).toEqual(BABY);
  });

  it('remembers nothing without a connection', async () => {
    await remember(BABY);
    mockAnswer = async () => OFFLINE;
    await openWithClockStopped(clientWithList([entry(EGG)]));

    expect(renders.at(-1)).toMatchObject({ name: 'From the list', error: true });
    expect(milestone()).toBeNull();
    expect(await remembered()).toEqual(BABY);
  });

  it('celebrates what the server says when the list is behind it', async () => {
    await remember(EGG);
    const answer = holdAnswer();
    await openWithClockStopped(clientWithList([entry(EGG)]));

    await answer(entry(BABY));

    expect(milestone()).toEqual({ kind: 'hatched' });
  });
});

describe('a start on a copy with the list and not the pack', () => {
  /** The module as a start of the app finds it, with no save waiting. */
  function afterRestart() {
    let module: QueryCache | undefined;
    jest.isolateModules(() => {
      module = jest.requireActual<QueryCache>('@/lib/queryCache');
    });
    return module!;
  }

  async function keepList(time: number) {
    const { persistOptions } = afterRestart();
    const client = newClient();
    const stop = persistQueryClientSubscribe({ ...persistOptions, queryClient: client });
    client.setQueryData(packsKey, [entry(BABY)], { updatedAt: time });
    await wait(SAVE_MS);
    stop();
  }

  async function startApp() {
    const { persistOptions } = afterRestart();
    await act(async () => {
      trees.push(
        create(
          <PersistQueryClientProvider client={newClient()} persistOptions={persistOptions}>
            <PackScreen />
          </PersistQueryClientProvider>,
        ),
      );
    });
    await settle(50);
  }

  it('shows the pack with no connection, and again on the next start', async () => {
    const time = Date.now() - 60_000;
    await keepList(time);
    mockAnswer = async () => OFFLINE;

    await startApp();
    expect(renders.at(-1)).toMatchObject({ name: 'From the list', pending: false, at: time });
    expect(mockReads).toBe(1);

    await settle(SAVE_MS);
    expect(await AsyncStorage.getItem(COPY)).toContain(`"queryKey":["packs","${ID}"]`);
    await act(async () => trees.pop()?.unmount());
    renders = [];

    await startApp();
    expect(renders.at(-1)).toMatchObject({ name: 'From the list', pending: false, at: time });
  });

  it('reads the pack once, and ends on the answer', async () => {
    await keepList(Date.now() - 60_000);
    const answer = holdAnswer();

    await startApp();
    await answer(entry(BABY, 'From the server'));

    expect(renders.at(-1)).toMatchObject({ name: 'From the server', pending: false });
    expect(mockReads).toBe(1);
  });
});

describe('what the list leaves alone', () => {
  it('a pack not in the list waits for the server', async () => {
    await open(clientWithList([entry(BABY)]), 'other');

    expect(renders[0]).toMatchObject({ name: undefined, pending: true });
    expect(mockReads).toBe(1);
  });

  it('with no list a pack waits for the server', async () => {
    await open(newClient());

    expect(renders[0]).toMatchObject({ name: undefined, pending: true });
  });

  it('an entry of its own wins over the list', async () => {
    const client = clientWithList([entry(BABY)]);
    client.setQueryData(['packs', ID], entry(BABY, 'Own entry'), { updatedAt: LIST_STAMP + 1 });
    await open(client);

    expect(renders[0]).toMatchObject({ name: 'Own entry', at: LIST_STAMP + 1 });
  });

  it('a pack known to be gone stays gone until the server says otherwise', async () => {
    const client = clientWithList([entry(BABY)]);
    client.setQueryData(['packs', ID], null);
    const answer = holdAnswer();
    await open(client);
    expect(renders[0]?.data).toBeNull();

    await answer(entry(BABY, 'From the server'));
    expect(renders.at(-1)).toMatchObject({ name: 'From the server' });
  });
});

describe('the camera on a pack opened from the list', () => {
  const answerOf = (status: string) => ({ status, canAskAgain: true, granted: status === 'granted', expires: 'never' });
  let screen: ReactTestRenderer;

  async function openCamera(client: QueryClient) {
    await act(async () => {
      screen = create(
        <QueryClientProvider client={client}>
          <FeedScreen />
        </QueryClientProvider>,
      );
    });
    trees.push(screen);
    await settle();
  }

  const shown = () => JSON.stringify(screen.toJSON());
  const hasCamera = () => screen.root.findAll((node) => node.type === 'CameraView').length === 1;

  describe('when the system can still ask', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(answerOf('undetermined'));
      mockRequest.mockImplementation(never);
    });

    it('asks at once, with the server still to answer', async () => {
      await openCamera(clientWithList([entry(BABY)]));

      expect(mockReads).toBe(1);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('asks only after the server for a pack not in the list', async () => {
      const answer = holdAnswer();
      await openCamera(newClient());
      expect(mockRequest).not.toHaveBeenCalled();

      await answer(entry(BABY));
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('asks once and then says the pack is gone, to someone removed from it', async () => {
      const answer = holdAnswer();
      await openCamera(clientWithList([entry(BABY)]));
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(shown()).not.toContain("This pack isn't here");

      await answer(null);

      expect(shown()).toContain("This pack isn't here");
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the camera is allowed', () => {
    beforeEach(() => {
      mockGet.mockResolvedValue(answerOf('granted'));
    });

    it('names the pack at once, also with no connection', async () => {
      mockAnswer = async () => OFFLINE;
      await openCamera(clientWithList([entry(BABY)]));

      expect(hasCamera()).toBe(true);
      expect(shown()).toContain('From the list');
    });

    it('closes on the server saying the pack is gone', async () => {
      const answer = holdAnswer();
      await openCamera(clientWithList([entry(BABY)]));
      expect(hasCamera()).toBe(true);

      await answer(null);

      expect(hasCamera()).toBe(false);
      expect(shown()).toContain("This pack isn't here");
    });
  });
});
