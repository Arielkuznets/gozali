import { HEALTH_STATE_MIN, STAGE_XP } from './constants.ts';
import type { CritterState, HealthState, Stage } from './types.ts';

export const STAGES: readonly Stage[] = ['egg', 'baby', 'kid', 'teen', 'adult', 'legend'];

export function stageRank(stage: Stage): number {
  return STAGES.indexOf(stage);
}

/**
 * The stage a hatched critter's XP reaches. Stages never go down, so callers keep the
 * current stage when it is higher (for example after the thresholds are recalibrated).
 */
export function stageForXp(xp: number): Stage {
  for (const [stage, minXp] of STAGE_XP) {
    if (xp >= minXp) return stage;
  }
  return 'egg';
}

export function healthState(critter: Pick<CritterState, 'status' | 'health'>): HealthState {
  if (critter.status === 'ran_away') return 'ran_away';
  for (const [state, minHealth] of HEALTH_STATE_MIN) {
    if (critter.health >= minHealth) return state;
  }
  return 'ran_away';
}
