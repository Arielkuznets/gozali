// Runs the game rules over simulated packs to calibrate the numbers in src/constants.ts.
// Usage: node scripts/simulate.ts [--runs=1000] [--days=60] [--seed=1]
//
// Model: every member feeds on a given day with probability `rate`. Rest days are used
// automatically, and a member who would miss uses the month's joker half of the time.
// Members start with their first feed, and fall asleep and wake up exactly as the rules say.

import { HEALTH_START, SLEEP_WINDOW_DAYS, closeDay, stageRank } from '../src/index.ts';
import type { CritterState, MemberDay, Stage } from '../src/index.ts';

interface Scenario {
  category: string;
  restDays: number;
  rates: readonly number[];
}

const SCENARIOS: readonly Scenario[] = [
  { category: 'Reading', restDays: 0, rates: [0.75, 0.9, 0.97] },
  { category: 'Study', restDays: 1, rates: [0.7, 0.85, 0.95] },
  { category: 'Gym', restDays: 3, rates: [0.4, 0.55, 0.7] },
];
const SIZES = [2, 3, 5, 8];
const JOKER_CHANCE = 0.5;
const DAYS_PER_MONTH = 30;
/** Below this the critter is weak, sick or gone. */
const LOW_HEALTH = 40;

function option(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? fallback : Number(found.slice(prefix.length));
}

/** Small seeded PRNG, so the same options always print the same numbers. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface SimMember {
  started: boolean;
  sleeping: boolean;
  restUsed: number;
  jokerMonth: number;
  recentMisses: boolean[];
}

interface PackRun {
  appliedDays: number;
  successDays: number;
  hatchedDays: number;
  healthSum: number;
  lowDays: number;
  ranAway: boolean;
  kidDay: number | null;
  teenDay: number | null;
  asleepMemberDays: number;
}

function reached(stage: Stage, target: Stage): boolean {
  return stageRank(stage) >= stageRank(target);
}

function simulatePack(size: number, rate: number, restDays: number, days: number, random: () => number): PackRun {
  const members: SimMember[] = Array.from({ length: size }, () => ({
    started: false,
    sleeping: false,
    restUsed: 0,
    jokerMonth: -1,
    recentMisses: [],
  }));
  let critter: CritterState = { status: 'egg', health: HEALTH_START, xp: 0, stage: 'egg', streak: 0, marks: [] };
  const run: PackRun = {
    appliedDays: 0,
    successDays: 0,
    hatchedDays: 0,
    healthSum: 0,
    lowDays: 0,
    ranAway: false,
    kidDay: null,
    teenDay: null,
    asleepMemberDays: 0,
  };

  for (let day = 0; day < days; day += 1) {
    if (day % 7 === 0) for (const member of members) member.restUsed = 0;
    const month = Math.floor(day / DAYS_PER_MONTH);

    const inputs: MemberDay[] = members.map((member, index) => {
      const fedToday = random() < rate;
      if (fedToday) {
        member.started = true;
        // A feed wakes a sleeping member right away, and the miss count starts over.
        if (member.sleeping) {
          member.sleeping = false;
          member.recentMisses = [];
        }
      }
      const wouldMiss = !fedToday && member.started && !member.sleeping && member.restUsed >= restDays;
      return {
        userId: String(index),
        membership: member.sleeping ? 'sleeping' : 'active',
        hasStarted: member.started,
        paused: false,
        fedToday,
        jokerToday: wouldMiss && member.jokerMonth !== month && random() < JOKER_CHANCE,
        restDeclaredToday: false,
        restDaysUsedThisWeek: member.restUsed,
        recentMisses: member.recentMisses.filter(Boolean).length,
      };
    });

    const result = closeDay({ critter, members: inputs, restDaysPerWeek: restDays });
    critter = result.critter;

    result.outcomes.forEach(({ outcome }, index) => {
      const member = members[index]!;
      if (outcome === 'rest') member.restUsed += 1;
      if (outcome === 'joker') member.jokerMonth = month;
      if (outcome === 'sleeping') run.asleepMemberDays += 1;
      if (outcome === 'fed' || outcome === 'joker' || outcome === 'rest' || outcome === 'missed') {
        member.recentMisses.push(outcome === 'missed');
        if (member.recentMisses.length > SLEEP_WINDOW_DAYS - 1) member.recentMisses.shift();
      }
    });
    for (const userId of result.newlySleeping) members[Number(userId)]!.sleeping = true;

    if (result.applied) {
      run.appliedDays += 1;
      if (result.type === 'success') run.successDays += 1;
    }
    if (critter.status !== 'egg') {
      // Health stays at 0 while the critter is away, so those days count as low.
      run.hatchedDays += 1;
      run.healthSum += critter.health;
      if (critter.health < LOW_HEALTH) run.lowDays += 1;
    }
    if (result.events.some((event) => event.type === 'ran_away')) run.ranAway = true;
    if (run.kidDay === null && reached(critter.stage, 'kid')) run.kidDay = day + 1;
    if (run.teenDay === null && reached(critter.stage, 'teen')) run.teenDay = day + 1;
  }
  return run;
}

interface Row {
  rate: number;
  size: number;
  success: number;
  avgHealth: number;
  lowHealth: number;
  ranAway: number;
  kidDay: number | null;
  teenDay: number | null;
  asleep: number;
}

/** Median over all runs, counting runs that never got there as the latest; null if most never did. */
function median(values: number[], runs: number): number | null {
  const index = Math.floor((runs - 1) / 2);
  if (values.length <= index) return null;
  return [...values].sort((a, b) => a - b)[index] ?? null;
}

function summarize(
  size: number,
  rate: number,
  restDays: number,
  runs: number,
  days: number,
  random: () => number,
): Row {
  let appliedDays = 0;
  let successDays = 0;
  let hatchedDays = 0;
  let healthSum = 0;
  let lowDays = 0;
  let ranAway = 0;
  let asleep = 0;
  const kidDays: number[] = [];
  const teenDays: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const run = simulatePack(size, rate, restDays, days, random);
    appliedDays += run.appliedDays;
    successDays += run.successDays;
    hatchedDays += run.hatchedDays;
    healthSum += run.healthSum;
    lowDays += run.lowDays;
    asleep += run.asleepMemberDays;
    if (run.ranAway) ranAway += 1;
    if (run.kidDay !== null) kidDays.push(run.kidDay);
    if (run.teenDay !== null) teenDays.push(run.teenDay);
  }
  return {
    rate,
    size,
    success: successDays / appliedDays,
    avgHealth: healthSum / hatchedDays,
    lowHealth: lowDays / hatchedDays,
    ranAway: ranAway / runs,
    kidDay: median(kidDays, runs),
    teenDay: median(teenDays, runs),
    asleep: asleep / (runs * days * size),
  };
}

function table(rows: readonly Row[], days: number): string[] {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  const day = (value: number | null) => (value === null ? `>${days}` : String(value));
  const header = ['rate', 'size', 'success', 'avg health', 'low', 'ran away', 'kid', 'teen', 'asleep'];
  const lines = rows.map((row) => [
    row.rate.toFixed(2),
    String(row.size),
    percent(row.success),
    String(Math.round(row.avgHealth)),
    percent(row.lowHealth),
    percent(row.ranAway),
    day(row.kidDay),
    day(row.teenDay),
    percent(row.asleep),
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...lines.map((line) => line[column]!.length)));
  const format = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column]!)).join('  ').trimEnd();
  return [format(header), ...lines.map(format)];
}

const runs = option('runs', 1000);
const days = option('days', 60);
const seed = option('seed', 1);
const random = mulberry32(seed);

console.log(`Gozali simulator: ${runs} runs per row, ${days} days, seed ${seed}`);
console.log('rate: chance a member feeds on a given day; success: share of counted days that succeeded;');
console.log('avg health: after hatching, 0 while away; low: days below 40 health or away;');
console.log('ran away: packs whose critter ran away at least once;');
console.log('kid, teen: median day the stage was reached; asleep: share of member-days spent asleep.');
for (const scenario of SCENARIOS) {
  console.log('');
  console.log(`${scenario.category} (${scenario.restDays} rest days a week)`);
  const rows = scenario.rates.flatMap((rate) =>
    SIZES.map((size) => summarize(size, rate, scenario.restDays, runs, days, random)),
  );
  for (const line of table(rows, days)) console.log(line);
}
