import {
  EARLY_BIRD_BEFORE_HOUR,
  EARLY_BIRD_MIN_FEEDERS,
  FEEDERS_TO_HATCH,
  FULL_HOUSE_MIN_MEMBERS,
  HEALTH_MAX,
  HEALTH_ON_RETURN,
  HEALTH_PENALTY_PER_MISS,
  HEALTH_SUCCESS_BONUS,
  MEDAL_STREAK,
  MEMBERS_PER_ALLOWED_MISS,
  NIGHT_OWL_FROM_HOUR,
  RETURN_STREAK,
  SLEEP_MISSES,
} from './constants.ts';
import { healthState, stageForXp, stageRank } from './stages.ts';
import { minutesIntoPackDay } from './time.ts';
import type {
  CritterState,
  DayEvent,
  DayFacts,
  DayInput,
  DayResult,
  DayType,
  Mark,
  MemberDay,
  MemberOutcome,
} from './types.ts';

const COUNTED_OUTCOMES: ReadonlySet<MemberOutcome> = new Set(['fed', 'joker', 'rest', 'missed']);
const NO_FACTS: DayFacts = { fullHouse: false, earlyBird: false, nightOwlFeeds: 0 };

/** Misses a day can absorb and still succeed: 0 for 2–4 counted members, 1 for 5–8. */
export function allowedMisses(countedMembers: number): number {
  return Math.floor(countedMembers / MEMBERS_PER_ALLOWED_MISS);
}

/** How one member's day counts. The order of the checks is the order in spec section 5. */
export function memberOutcome(member: MemberDay, restDaysPerWeek: number): MemberOutcome {
  if (member.membership === 'left') return 'left';
  if (!member.hasStarted) return 'not_started';
  if (member.paused) return 'paused';
  // A feed wakes a sleeping member and cancels a joker or a declared rest for the same day.
  if (member.fedToday) return 'fed';
  if (member.membership === 'sleeping') return 'sleeping';
  if (member.jokerToday) return 'joker';
  if (member.restDeclaredToday) return 'rest';
  if (member.restDaysUsedThisWeek < restDaysPerWeek) return 'rest';
  return 'missed';
}

/** Closes one pack day: who counted, what kind of day it was, and the critter's new state. */
export function closeDay(input: DayInput): DayResult {
  const rows = input.members.map((member) => ({
    member,
    outcome: memberOutcome(member, input.restDaysPerWeek),
  }));
  const counted = rows.filter((row) => COUNTED_OUTCOMES.has(row.outcome)).length;
  const feeders = rows.filter((row) => row.outcome === 'fed').map((row) => row.member);
  const misses = rows.filter((row) => row.outcome === 'missed').length;
  const allowed = allowedMisses(counted);
  const type: DayType = misses > allowed ? 'fail' : feeders.length > 0 ? 'success' : 'neutral';

  const before = input.critter;
  const events: DayEvent[] = [];
  const advanced = advanceCritter(before, type, feeders.length, misses, events);
  let after = advanced.critter;

  if (advanced.applied) {
    if (after.streak >= MEDAL_STREAK) after = { ...after, marks: withMark(after.marks, 'medal', events) };
    after = evolve(after, events);
    const from = healthState(before);
    const to = healthState(after);
    if (from !== to) events.push({ type: 'health_state_changed', from, to });
  }

  const newlySleeping = rows
    .filter((row) => row.outcome === 'missed' && row.member.recentMisses + 1 >= SLEEP_MISSES)
    .map((row) => row.member.userId);
  for (const userId of newlySleeping) events.push({ type: 'member_slept', userId });

  return {
    type,
    applied: advanced.applied,
    outcomes: rows.map((row) => ({ userId: row.member.userId, outcome: row.outcome })),
    counted,
    feeds: feeders.length,
    misses,
    allowedMisses: allowed,
    healthBefore: before.health,
    critter: after,
    newlySleeping,
    events,
    facts: advanced.applied ? dayFacts(type, counted, feeders) : NO_FACTS,
  };
}

function advanceCritter(
  before: CritterState,
  type: DayType,
  feeds: number,
  misses: number,
  events: DayEvent[],
): { critter: CritterState; applied: boolean } {
  if (before.status === 'egg') {
    // Egg days change nothing until the first successful day with enough feeders hatches it.
    if (type !== 'success' || feeds < FEEDERS_TO_HATCH) return { critter: before, applied: false };
    events.push({ type: 'hatched' });
    return { critter: applyActiveDay({ ...before, status: 'active' }, type, misses, events), applied: true };
  }
  if (before.status === 'active') {
    return { critter: applyActiveDay(before, type, misses, events), applied: true };
  }
  return { critter: applyRanAwayDay(before, type, events), applied: true };
}

function applyActiveDay(critter: CritterState, type: DayType, misses: number, events: DayEvent[]): CritterState {
  // Bonus and penalties are summed first and clamped once, so 100 + 10 - 8 stays 100.
  const bonus = type === 'success' ? HEALTH_SUCCESS_BONUS : 0;
  const health = clamp(critter.health + bonus - HEALTH_PENALTY_PER_MISS * misses, 0, HEALTH_MAX);
  const xp = critter.xp + (type === 'success' ? 1 : 0);
  if (health === 0) {
    events.push({ type: 'ran_away' });
    return { ...critter, status: 'ran_away', health, xp, streak: 0 };
  }
  return { ...critter, health, xp, streak: nextStreak(critter.streak, type) };
}

function applyRanAwayDay(critter: CritterState, type: DayType, events: DayEvent[]): CritterState {
  // While away, health stays at 0 and no XP is earned; only the streak counts toward the return.
  const streak = nextStreak(critter.streak, type);
  if (streak < RETURN_STREAK) return { ...critter, health: 0, streak };
  events.push({ type: 'returned' });
  return {
    ...critter,
    status: 'active',
    health: HEALTH_ON_RETURN,
    streak,
    marks: withMark(critter.marks, 'bandage', events),
  };
}

function evolve(critter: CritterState, events: DayEvent[]): CritterState {
  if (critter.status === 'egg') return critter;
  const target = stageForXp(critter.xp);
  if (stageRank(target) <= stageRank(critter.stage)) return critter;
  // Hatching already reports the move from egg to baby.
  if (critter.stage !== 'egg') events.push({ type: 'evolved', from: critter.stage, to: target });
  return { ...critter, stage: target };
}

function dayFacts(type: DayType, counted: number, feeders: readonly MemberDay[]): DayFacts {
  const earlyLimit = minutesIntoPackDay(EARLY_BIRD_BEFORE_HOUR);
  const nightStart = minutesIntoPackDay(NIGHT_OWL_FROM_HOUR);
  return {
    fullHouse: counted >= FULL_HOUSE_MIN_MEMBERS && feeders.length === counted,
    earlyBird:
      type === 'success' &&
      feeders.length >= EARLY_BIRD_MIN_FEEDERS &&
      feeders.every((member) => member.fedAtMinute !== undefined && member.fedAtMinute < earlyLimit),
    nightOwlFeeds: feeders.filter(
      (member) => member.fedAtMinute !== undefined && member.fedAtMinute >= nightStart,
    ).length,
  };
}

function nextStreak(streak: number, type: DayType): number {
  if (type === 'success') return streak + 1;
  if (type === 'fail') return 0;
  return streak;
}

function withMark(marks: readonly Mark[], mark: Mark, events: DayEvent[]): readonly Mark[] {
  if (marks.includes(mark)) return marks;
  events.push({ type: 'mark_added', mark });
  return [...marks, mark];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
