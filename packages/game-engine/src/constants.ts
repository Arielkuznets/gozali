// Every tunable number of the game. The values are initial and get calibrated
// with the simulator (scripts/simulate.ts) before and during the pilot.

export const HEALTH_START = 70;
export const HEALTH_MAX = 100;
export const HEALTH_SUCCESS_BONUS = 10;
export const HEALTH_PENALTY_PER_MISS = 8;
export const HEALTH_ON_RETURN = 40;

/** One miss is allowed per this many counted members: 0 for 2–4 members, 1 for 5–8. */
export const MEMBERS_PER_ALLOWED_MISS = 5;

/** Feeders needed on a successful day for the egg to hatch. */
export const FEEDERS_TO_HATCH = 2;

/** Successful days in a row that bring the critter back after it ran away. */
export const RETURN_STREAK = 3;

/** Streak that earns the permanent medal. */
export const MEDAL_STREAK = 30;

/** Misses inside the window, counted since the member last woke up, that put a member to sleep. */
export const SLEEP_MISSES = 3;
export const SLEEP_WINDOW_DAYS = 7;

/** Local hour at which a pack day ends, and how long offline feeds are still accepted after it. */
export const DAY_END_HOUR = 3;
export const GRACE_MINUTES = 60;

export const MAX_MEMBERS = 8;
export const REST_DAYS_MAX = 4;
export const JOKERS_PER_MONTH = 1;

export const PAUSE_MIN_DAYS = 3;
export const PAUSE_MAX_DAYS = 60;
export const PAUSE_COOLDOWN_DAYS = 30;

/** Facts that feed achievements. */
export const FULL_HOUSE_MIN_MEMBERS = 4;
export const EARLY_BIRD_BEFORE_HOUR = 12;
export const EARLY_BIRD_MIN_FEEDERS = 2;
export const NIGHT_OWL_FROM_HOUR = 23;

/** XP each stage needs once the egg hatched, from the highest stage down. */
export const STAGE_XP = [
  ['legend', 100],
  ['adult', 45],
  ['teen', 21],
  ['kid', 7],
  ['baby', 1],
] as const;

/** Lowest health of each health state, from the best state down. */
export const HEALTH_STATE_MIN = [
  ['thriving', 85],
  ['happy', 60],
  ['hungry', 40],
  ['weak', 20],
  ['sick', 1],
] as const;
