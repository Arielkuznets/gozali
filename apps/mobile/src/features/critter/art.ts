import { critterArtFor, isNightHour, type CritterArt } from '@gozali/critter-art';
import { STAGE_XP, healthState, type HealthState, type Stage } from '@gozali/game-engine';

import type { PackCritter } from '@/features/packs/api';
import type { Category } from '@/features/packs/constants';

export { parseOutfit } from '@gozali/critter-art';

/** The device's calendar day, YYYY-MM-DD. */
export function localDay(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Night on the device clock (22:00-07:00), when the critter sleeps (spec section 4). */
export function isNight(now: Date): boolean {
  return isNightHour(now.getHours());
}

export type CritterLook = HealthState | 'egg';

export function critterLook(critter: Pick<PackCritter, 'status' | 'health'>): CritterLook {
  return critter.status === 'egg' ? 'egg' : healthState(critter);
}

export function critterArt(
  critter: PackCritter,
  context: { category: Category; now: Date; mood?: number; cracking?: boolean },
): CritterArt {
  return critterArtFor(critter, {
    category: context.category,
    mood: context.mood,
    sleeping: isNight(context.now),
    cracking: context.cracking,
    day: localDay(context.now),
  });
}

/** XP progress inside the current stage, or null at the last stage. */
export function stageProgress(stage: Stage): { next: Stage; from: number; to: number } | null {
  // STAGE_XP runs from the highest stage down.
  const ladder = [...STAGE_XP].reverse();
  const index = ladder.findIndex(([name]) => name === stage);
  const next = ladder[index + 1];
  if (stage === 'egg' || !next) return null;
  const from = ladder[index]?.[1] ?? 0;
  return { next: next[0], from, to: next[1] };
}
