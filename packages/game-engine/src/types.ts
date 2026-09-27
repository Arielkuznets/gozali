export type CritterStatus = 'egg' | 'active' | 'ran_away';
export type Stage = 'egg' | 'baby' | 'kid' | 'teen' | 'adult' | 'legend';
export type HealthState = 'thriving' | 'happy' | 'hungry' | 'weak' | 'sick' | 'ran_away';
export type Mark = 'medal' | 'bandage';
export type Membership = 'active' | 'sleeping' | 'left';
export type MemberOutcome =
  | 'fed'
  | 'joker'
  | 'rest'
  | 'missed'
  | 'paused'
  | 'sleeping'
  | 'not_started'
  | 'left';
export type DayType = 'success' | 'neutral' | 'fail';
export type WeekStart = 'sunday' | 'monday';

export interface CritterState {
  status: CritterStatus;
  health: number;
  xp: number;
  stage: Stage;
  streak: number;
  marks: readonly Mark[];
}

/** Everything the rules need to know about one member on the day being closed. */
export interface MemberDay {
  userId: string;
  membership: Membership;
  /** Has at least one counted feed in this pack, today included. */
  hasStarted: boolean;
  /** A pause covers this day. */
  paused: boolean;
  fedToday: boolean;
  /** Minutes from the start of the pack day to today's counted feed. */
  fedAtMinute?: number;
  jokerToday: boolean;
  restDeclaredToday: boolean;
  /** Rest days used earlier this week, declared or automatic. */
  restDaysUsedThisWeek: number;
  /** Misses in the previous SLEEP_WINDOW_DAYS - 1 days, counted since the member last woke up. */
  recentMisses: number;
}

export interface DayInput {
  critter: CritterState;
  members: readonly MemberDay[];
  restDaysPerWeek: number;
}

export type DayEvent =
  | { type: 'hatched' }
  | { type: 'evolved'; from: Stage; to: Stage }
  | { type: 'health_state_changed'; from: HealthState; to: HealthState }
  | { type: 'ran_away' }
  | { type: 'returned' }
  | { type: 'mark_added'; mark: Mark }
  | { type: 'member_slept'; userId: string };

/** Facts about the day that achievements count. */
export interface DayFacts {
  /** Every counted member fed, with at least FULL_HOUSE_MIN_MEMBERS counted. */
  fullHouse: boolean;
  /** A successful day where everyone who fed did it before noon, with at least two feeders. */
  earlyBird: boolean;
  /** Feeds from 23:00 until the day ended. */
  nightOwlFeeds: number;
}

export interface DayResult {
  type: DayType;
  /** False for an egg day that did not hatch it: the critter does not change. */
  applied: boolean;
  outcomes: ReadonlyArray<{ userId: string; outcome: MemberOutcome }>;
  counted: number;
  feeds: number;
  misses: number;
  allowedMisses: number;
  healthBefore: number;
  critter: CritterState;
  /** Coins the day earned the pack: only a successful day while the critter is home. */
  coins: number;
  newlySleeping: readonly string[];
  events: readonly DayEvent[];
  facts: DayFacts;
}
