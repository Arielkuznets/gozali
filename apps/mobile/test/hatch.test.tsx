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

  it('is sure once Eve is on a joker, or when Eve has never fed', () => {
    const joker: TodayPasses = { passes: new Map([['eve', 'joker']]), paused: new Set() };
    expect(hatchesTonight(pack, fed, joker, known({}))).toBe(true);
    expect(hatchesTonight(pack, fed, noPasses, known({ hasStarted: false }))).toBe(true);
  });

  it('is not sure before the server said who has started', () => {
    expect(hatchesTonight(pack, fed, noPasses, undefined)).toBe(false);
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
