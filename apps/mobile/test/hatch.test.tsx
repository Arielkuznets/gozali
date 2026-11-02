import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { HatchSteps } from '@/features/critter/HatchSteps';
import { hatchesTonight } from '@/features/critter/hatch';
import type { MembersToday, TodayPasses } from '@/features/days/api';
import type { PackMember } from '@/features/packs/api';

const member = (user_id: string): PackMember => ({
  user_id,
  role: 'member',
  status: 'active',
  joined_at: '2026-10-01T10:00:00Z',
  profiles: null,
});
const pack = [member('noa'), member('dan'), member('eve')];
const fed = new Set(['noa', 'dan']);
const noPasses: TodayPasses = { passes: new Map(), paused: new Set() };
const known = (eve: Partial<MembersToday['members'][number]>): MembersToday => ({
  restDaysPerWeek: 0,
  members: [
    { userId: 'noa', membership: 'active', hasStarted: true, restDaysUsedThisWeek: 0 },
    { userId: 'dan', membership: 'active', hasStarted: true, restDaysUsedThisWeek: 0 },
    { userId: 'eve', membership: 'active', hasStarted: true, restDaysUsedThisWeek: 0, ...eve },
  ],
});

describe('whether the egg surely hatches tonight', () => {
  it('is not sure while Eve, who has started and has no rest days, could still miss', () => {
    expect(hatchesTonight(pack, fed, noPasses, known({}))).toBe(false);
  });

  it('is sure when Eve has never fed', () => {
    expect(hatchesTonight(pack, fed, noPasses, known({ hasStarted: false }))).toBe(true);
  });

  it('is not sure while Eve could take back a joker or a pause with no rest days to cover her', () => {
    const joker: TodayPasses = { passes: new Map([['eve', 'joker']]), paused: new Set() };
    const paused: TodayPasses = { passes: new Map(), paused: new Set(['eve']) };
    expect(hatchesTonight(pack, fed, joker, known({}))).toBe(false);
    expect(hatchesTonight(pack, fed, paused, known({}))).toBe(false);
  });

  it('is sure on a joker when a rest day would still cover Eve', () => {
    const joker: TodayPasses = { passes: new Map([['eve', 'joker']]), paused: new Set() };
    expect(hatchesTonight(pack, fed, joker, { ...known({}), restDaysPerWeek: 1 })).toBe(true);
  });

  it('is not sure before the server said who has started', () => {
    expect(hatchesTonight(pack, fed, noPasses, undefined)).toBe(false);
  });

  it('counts a feed as started, whatever the earlier answer said', () => {
    const firstFeeds: MembersToday = {
      restDaysPerWeek: 0,
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
});

describe('the hatch steps', () => {
  const shown = (certain: boolean) => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<HatchSteps friendJoined fedToday={2} certain={certain} />);
    });
    return JSON.stringify(tree.toJSON());
  };

  it('promise tonight only when it is sure', () => {
    expect(shown(true)).toContain('It hatches tonight, when today ends 🎉');
    expect(shown(false)).not.toContain('🎉');
    expect(shown(false)).toContain('It hatches tonight if no one else misses today');
  });
});
