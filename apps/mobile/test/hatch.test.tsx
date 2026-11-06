import { addDays, type DayInput, type MemberDay } from '@gozali/game-engine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { HatchSteps } from '@/features/critter/HatchSteps';
import { hatchesAtClose, hatchesTonight } from '@/features/critter/hatch';
import { keptToday, useTodayPasses, type MembersToday, type TodayPasses } from '@/features/days/api';
import type { PackMember } from '@/features/packs/api';

// What today's read of the pauses answers; nobody has a joker or a rest.
let mockPauses: { user_id: string; starts_on: string }[] = [];
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      const read: Record<string, unknown> = {
        then: (done: (answer: unknown) => void) => done({ data: table === 'pauses' ? mockPauses : [], error: null }),
      };
      for (const step of ['select', 'eq', 'lte', 'gte']) read[step] = () => read;
      return read;
    },
  }),
}));

const member = (user_id: string): PackMember => ({
  user_id,
  role: 'member',
  status: 'active',
  joined_at: '2026-10-01T10:00:00Z',
  profiles: null,
});
const pack = [member('noa'), member('dan'), member('eve')];
const fed = new Set(['noa', 'dan']);
const noPasses: TodayPasses = { passes: new Map(), paused: new Set(), pausedForSure: new Set() };
const known = (eve: Partial<MembersToday['members'][number]>): MembersToday => ({
  day: '2026-10-29',
  restDaysPerWeek: 0,
  dayToClose: null,
  members: [
    { userId: 'noa', membership: 'active', hasStarted: true, restDaysUsedThisWeek: 0 },
    { userId: 'dan', membership: 'active', hasStarted: true, restDaysUsedThisWeek: 0 },
    { userId: 'eve', membership: 'active', hasStarted: true, restDaysUsedThisWeek: 0, ...eve },
  ],
});

const dayBefore = (members: MemberDay[]): DayInput => ({
  critter: { status: 'egg', health: 70, xp: 0, stage: 'egg', streak: 0, marks: [] },
  restDaysPerWeek: 0,
  members,
});

describe('whether the egg surely hatches tonight', () => {
  it('is not sure while Eve, who has started and has no rest days, could still miss', () => {
    expect(hatchesTonight(pack, fed, noPasses, known({}))).toBe(false);
  });

  it('is sure when Eve has never fed', () => {
    expect(hatchesTonight(pack, fed, noPasses, known({ hasStarted: false }))).toBe(true);
  });

  it('is not sure while Eve could take back a joker or a pause with no rest days to cover her', () => {
    const joker: TodayPasses = { ...noPasses, passes: new Map([['eve', 'joker']]) };
    const paused: TodayPasses = { ...noPasses, paused: new Set(['eve']) };
    expect(hatchesTonight(pack, fed, joker, known({}))).toBe(false);
    expect(hatchesTonight(pack, fed, paused, known({}))).toBe(false);
  });

  it('is sure on a joker when a rest day would still cover Eve', () => {
    const joker: TodayPasses = { ...noPasses, passes: new Map([['eve', 'joker']]) };
    expect(hatchesTonight(pack, fed, joker, { ...known({}), restDaysPerWeek: 1 })).toBe(true);
  });

  it('is not sure before the server said who has started', () => {
    expect(hatchesTonight(pack, fed, noPasses, undefined)).toBe(false);
  });

  it('counts a feed as started, whatever the earlier answer said', () => {
    const firstFeeds: MembersToday = {
      ...known({}),
      members: [
        { userId: 'noa', membership: 'active', hasStarted: false, restDaysUsedThisWeek: 0 },
        { userId: 'dan', membership: 'active', hasStarted: false, restDaysUsedThisWeek: 0 },
      ],
    };
    expect(hatchesTonight([member('noa'), member('dan')], fed, noPasses, firstFeeds)).toBe(true);
  });

  it('takes a member who joined after the answer for someone who has not started', () => {
    expect(hatchesTonight([...pack, member('zoe')], fed, noPasses, known({ hasStarted: false }))).toBe(true);
  });

  it('is not sure while a day before today waits for its close', () => {
    const certain = known({ hasStarted: false });
    expect(hatchesTonight(pack, fed, noPasses, { ...certain, dayToClose: dayBefore([]) })).toBe(false);
  });

  it('goes by today alone on a server that says nothing of the day before', () => {
    const { day, dayToClose, ...older } = known({ hasStarted: false });
    expect(hatchesTonight(pack, fed, noPasses, older as MembersToday)).toBe(true);
  });
});

describe('a pause Eve can or can not end', () => {
  const NOW = new Date('2026-10-29T10:00:00Z');
  const startedDaysAgo = (days: number) => addDays('2026-10-29', -days);

  /** Today's passes, as the real hook reads them. */
  async function readToday() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    let today: TodayPasses | undefined;
    function Reader() {
      const { data } = useTodayPasses({ id: 'pack', timezone: 'UTC' }, NOW);
      useEffect(() => {
        today = data;
      });
      return null;
    }
    await act(async () => {
      create(
        <QueryClientProvider client={client}>
          <Reader />
        </QueryClientProvider>,
      );
    });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    return today!;
  }

  it.each([
    ['its first day', 0],
    ['its third day', 2],
  ])('is sure on %s, as end_pause refuses then and the close leaves her out', async (_name, days) => {
    mockPauses = [{ user_id: 'eve', starts_on: startedDaysAgo(days) }];
    expect(hatchesTonight(pack, fed, await readToday(), known({}))).toBe(true);
  });

  it('is not sure from its fourth day, when she can end it and miss', async () => {
    mockPauses = [{ user_id: 'eve', starts_on: startedDaysAgo(3) }];
    expect(hatchesTonight(pack, fed, await readToday(), known({}))).toBe(false);
  });

  it('goes the same way by the pack the phone holds', () => {
    const held = (days: number) =>
      keptToday(
        {
          timezone: 'UTC',
          pack_members: pack.map((one) =>
            one.user_id === 'eve' ? { ...one, pauses: [{ starts_on: startedDaysAgo(days), ends_on: addDays('2026-10-29', 9) }] } : one,
          ),
        },
        NOW,
      );
    expect(hatchesTonight(pack, fed, held(2), known({}))).toBe(true);
    expect(hatchesTonight(pack, fed, held(3), known({}))).toBe(false);
  });
});

describe('whether the day that ended hatches the egg at its close', () => {
  const memberDay = (userId: string, facts: Partial<MemberDay>): MemberDay => ({
    userId,
    membership: 'active',
    hasStarted: true,
    paused: false,
    fedToday: false,
    jokerToday: false,
    restDeclaredToday: false,
    restDaysUsedThisWeek: 0,
    recentMisses: 0,
    ...facts,
  });
  const ended = (eve: Partial<MemberDay>, outage?: boolean): MembersToday => ({
    ...known({}),
    dayToClose: {
      ...dayBefore([memberDay('noa', { fedToday: true }), memberDay('dan', { fedToday: true }), memberDay('eve', eve)]),
      outage,
    },
  });

  it('is so when two fed and the day succeeds', () => {
    expect(hatchesAtClose(ended({ fedToday: true }))).toBe(true);
    expect(hatchesAtClose(ended({ hasStarted: false }))).toBe(true);
  });

  it('is so on a joker, which nobody can take back once the day ended', () => {
    expect(hatchesAtClose(ended({ jokerToday: true }))).toBe(true);
  });

  it('is not so when a miss fails that day, or with fewer than two feeds', () => {
    expect(hatchesAtClose(ended({}))).toBe(false);
    expect(hatchesAtClose({ ...known({}), dayToClose: dayBefore([memberDay('noa', { fedToday: true })]) })).toBe(false);
  });

  it('is so on an outage day, whose close excuses the miss', () => {
    expect(hatchesAtClose(ended({}, true))).toBe(true);
    expect(hatchesAtClose(ended({}, false))).toBe(false);
  });

  it('is not so when nothing waits for a close, or the server says nothing of it', () => {
    expect(hatchesAtClose(undefined)).toBe(false);
    expect(hatchesAtClose(known({}))).toBe(false);
    const { dayToClose, ...older } = known({});
    expect(hatchesAtClose(older as MembersToday)).toBe(false);
  });
});

describe('the hatch steps', () => {
  const shown = (certain: boolean, { fedToday = 2, hatching = false } = {}) => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<HatchSteps friendJoined fedToday={fedToday} certain={certain} hatching={hatching} />);
    });
    return JSON.stringify(tree.toJSON());
  };

  it('promise tonight only when it is sure', () => {
    expect(shown(true)).toContain('It hatches tonight, when today ends 🎉');
    expect(shown(false)).not.toContain('🎉');
    expect(shown(false)).toContain('It hatches tonight if nobody misses today');
  });

  it('keep the feeds of the day that ended while its close hatches the egg, not the new 0/2', () => {
    const waiting = shown(false, { fedToday: 0, hatching: true });
    expect(waiting).toContain('Two of you fed on the same day');
    expect(waiting).toContain('It hatches very soon 🎉');
    expect(waiting).not.toContain('0/2');
  });

  it('start again from the new day when the day that ended hatches nothing', () => {
    expect(shown(false, { fedToday: 0 })).toContain('0/2');
  });
});
