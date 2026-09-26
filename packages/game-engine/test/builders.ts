import { closeDay } from '../src/index.ts';
import type { CritterState, DayResult, MemberDay } from '../src/index.ts';

let nextId = 0;

/** A started, active member who has not fed today and has no rest days left by default. */
export function member(overrides: Partial<MemberDay> = {}): MemberDay {
  nextId += 1;
  return {
    userId: `u${nextId}`,
    membership: 'active',
    hasStarted: true,
    paused: false,
    fedToday: false,
    jokerToday: false,
    restDeclaredToday: false,
    restDaysUsedThisWeek: 0,
    recentMisses: 0,
    ...overrides,
  };
}

export function fed(overrides: Partial<MemberDay> = {}): MemberDay {
  return member({ fedToday: true, ...overrides });
}

export function critter(overrides: Partial<CritterState> = {}): CritterState {
  return { status: 'active', health: 70, xp: 10, stage: 'kid', streak: 3, marks: [], ...overrides };
}

export function close(
  members: MemberDay[],
  critterOverrides: Partial<CritterState> = {},
  restDaysPerWeek = 0,
): DayResult {
  return closeDay({ critter: critter(critterOverrides), members, restDaysPerWeek });
}

export function times<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make);
}
