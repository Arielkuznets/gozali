import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { milestoneFor, useMilestone, type Seen } from '@/features/critter/milestones';
import { usePack } from '@/features/packs/api';

type QueryCache = typeof import('@/lib/queryCache');

// What the server answers when the pack is fetched.
let mockAnswer: () => Promise<{ data: unknown; error: null }>;
jest.mock('@/lib/supabase', () => ({
  storedSession: async () => ({ user: { id: 'noa' } }),
  requireSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockAnswer() }) }) }),
  }),
}));

const PACK = 'gym-squad';
const SEEN_KEY = `gozali.seen.${PACK}`;
const EGG: Seen = { status: 'egg', stage: 'egg' };
const BABY: Seen = { status: 'active', stage: 'baby' };
const KID: Seen = { status: 'active', stage: 'kid' };
const AWAY: Seen = { status: 'ran_away', stage: 'kid' };
const ADULT: Seen = { status: 'active', stage: 'adult' };
/** Well past the second the persister holds a save back after the one before it. */
const SAVE_MS = 1500;
jest.setTimeout(15_000);

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const remembered = async () => JSON.parse((await AsyncStorage.getItem(SEEN_KEY)) ?? 'null') as Seen | null;
const remember = (seen: Seen) => AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));

let moment: ReturnType<typeof useMilestone>;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('critter milestones', () => {
  it('celebrates nothing the first time a pack is opened', () => {
    expect(milestoneFor(null, { status: 'active', stage: 'teen' })).toBeNull();
  });

  it('celebrates the hatching, even if the critter also grew since', () => {
    expect(milestoneFor({ status: 'egg', stage: 'egg' }, { status: 'active', stage: 'baby' })).toEqual({ kind: 'hatched' });
    expect(milestoneFor({ status: 'egg', stage: 'egg' }, { status: 'active', stage: 'kid' })).toEqual({ kind: 'hatched' });
  });

  it('celebrates a new stage', () => {
    expect(milestoneFor({ status: 'active', stage: 'kid' }, { status: 'active', stage: 'teen' })).toEqual({ kind: 'evolved', to: 'teen' });
  });

  it('celebrates the return after running away', () => {
    expect(milestoneFor({ status: 'ran_away', stage: 'kid' }, { status: 'active', stage: 'kid' })).toEqual({ kind: 'returned' });
  });

  it('stays quiet when nothing to celebrate happened', () => {
    expect(milestoneFor({ status: 'active', stage: 'kid' }, { status: 'active', stage: 'kid' })).toBeNull();
    expect(milestoneFor({ status: 'active', stage: 'kid' }, { status: 'ran_away', stage: 'kid' })).toBeNull();
  });
});

describe('what the phone remembers of the critter', () => {
  function Milestones({ critter, fetchedAt }: { critter: Seen; fetchedAt: number }) {
    moment = useMilestone(PACK, critter, fetchedAt);
    return null;
  }

  /** The pack screen opened on the copy kept on the phone; `answer` is the server coming in. */
  async function openOnCopy(kept: Seen) {
    let screen!: ReactTestRenderer;
    await act(async () => {
      screen = create(<Milestones critter={kept} fetchedAt={Date.now() - 60_000} />);
      await settle();
    });
    return {
      answer: (critter: Seen) =>
        act(async () => {
          screen.update(<Milestones critter={critter} fetchedAt={Date.now()} />);
          await settle();
        }),
    };
  }

  it('celebrates what the server says happened, once', async () => {
    await remember(EGG);
    const screen = await openOnCopy(EGG);

    await screen.answer(BABY);
    expect(moment.milestone).toEqual({ kind: 'hatched' });

    await act(async () => moment.dismiss());
    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(BABY);
  });

  it('remembers the critter the first time the server shows it', async () => {
    const screen = await openOnCopy(EGG);
    expect(await remembered()).toBeNull();

    await screen.answer(KID);

    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(KID);
  });

  it('takes nothing from a copy that stays alone, without a connection', async () => {
    await remember(BABY);
    const screen = await openOnCopy(EGG);
    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(BABY);

    await screen.answer(KID);
    expect(moment.milestone).toEqual({ kind: 'evolved', to: 'kid' });
  });

  it('celebrates what the copy already shows, once the server says the same', async () => {
    await remember(EGG);
    const screen = await openOnCopy(BABY);
    expect(moment.milestone).toBeNull();

    await screen.answer(BABY);
    expect(moment.milestone).toEqual({ kind: 'hatched' });
  });

  it('holds a return to the server: the copy can be from before the critter ran away', async () => {
    await remember(AWAY);
    const screen = await openOnCopy(KID);
    expect(moment.milestone).toBeNull();

    await screen.answer(AWAY);
    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(AWAY);
  });

  it('celebrates a return once, whatever an older copy shows', async () => {
    await remember(KID);
    const screen = await openOnCopy(AWAY);

    await screen.answer(KID);

    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(KID);
  });

  it('follows a new egg down, and celebrates its hatching and growing up', async () => {
    await remember(ADULT);
    const screen = await openOnCopy(ADULT);

    await screen.answer(EGG);
    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(EGG);

    await screen.answer(BABY);
    expect(moment.milestone).toEqual({ kind: 'hatched' });
    await act(async () => moment.dismiss());

    await screen.answer(KID);
    expect(moment.milestone).toEqual({ kind: 'evolved', to: 'kid' });
  });

  it('follows a critter replaced by a younger one, and celebrates the stages it reaches', async () => {
    await remember(ADULT);
    const screen = await openOnCopy(ADULT);

    await screen.answer(BABY);
    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(BABY);

    await screen.answer(KID);
    expect(moment.milestone).toEqual({ kind: 'evolved', to: 'kid' });
  });
});

describe('the app closed right after a celebration', () => {
  const COPY = 'gozali.query-cache';
  /** Long enough for the copy to come back, or an answer to reach the screen. */
  const START_MS = 50;
  const packWith = (critters: Seen) => ({ data: { id: PACK, critters }, error: null });

  let shown: Seen | null | undefined;

  function PackScreen() {
    const { data: pack, dataUpdatedAt } = usePack(PACK);
    shown = pack?.critters;
    moment = useMilestone(pack?.id, pack?.critters, dataUpdatedAt);
    return null;
  }

  /** A start of the app on what the phone holds, with no save waiting. */
  async function startApp() {
    let cache!: QueryCache;
    jest.isolateModules(() => {
      cache = jest.requireActual<QueryCache>('@/lib/queryCache');
    });
    // No garbage collection, whose timers would outlive the test.
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const app = await act(async () => {
      const tree = create(
        <PersistQueryClientProvider client={queryClient} persistOptions={cache.persistOptions}>
          <PackScreen />
        </PersistQueryClientProvider>,
      );
      await settle(START_MS);
      return tree;
    });
    const fetchAgain = () =>
      act(async () => {
        await queryClient.invalidateQueries();
        await settle(START_MS);
      });
    return { app, fetchAgain };
  }

  /** Until the result is called, what the app saves to the copy never reaches the phone. */
  function blockSaves() {
    const multiSet = jest.mocked(AsyncStorage.multiSet);
    const write = multiSet.getMockImplementation()!;
    multiSet.mockImplementation(async (pairs) => (pairs.some(([key]) => key === COPY) ? null : write(pairs)));
    return () => multiSet.mockImplementation(write);
  }

  it('celebrates the hatching once, and the next stage after it', async () => {
    mockAnswer = async () => packWith(EGG);
    const first = await startApp();
    await act(() => settle(SAVE_MS));
    expect(await AsyncStorage.getItem(COPY)).toContain('"status":"egg"');

    // The app is gone before the save held back gets through.
    const allowSaves = blockSaves();
    mockAnswer = async () => packWith(BABY);
    await first.fetchAgain();
    expect(moment.milestone).toEqual({ kind: 'hatched' });
    await act(async () => moment.dismiss());
    await act(async () => first.app.unmount());
    await settle(SAVE_MS);
    allowSaves();

    let serverAnswers = () => {};
    mockAnswer = () =>
      new Promise((resolve) => {
        serverAnswers = () => resolve(packWith(BABY));
      });
    const second = await startApp();
    expect(shown).toEqual(EGG);
    expect(await remembered()).toEqual(BABY);

    await act(async () => {
      serverAnswers();
      await settle(START_MS);
    });
    expect(moment.milestone).toBeNull();
    expect(await remembered()).toEqual(BABY);

    mockAnswer = async () => packWith(KID);
    await second.fetchAgain();
    expect(moment.milestone).toEqual({ kind: 'evolved', to: 'kid' });
    await act(async () => second.app.unmount());
  });
});
