import {
  BACKGROUND_ITEMS,
  HEAD_ITEMS,
  NECK_ITEMS,
  type CategoryItem,
  type CritterArt,
  type Outfit,
} from '@gozali/critter-art';
import { STAGE_XP, healthState, stageRank, type HealthState, type Mark, type Stage } from '@gozali/game-engine';

import type { PackCritter } from '@/features/packs/api';
import type { Category } from '@/features/packs/constants';
import { critterColors } from '@/theme/tokens';

/** The habit item a critter carries from the Kid stage; custom habits have none. */
const CATEGORY_ITEMS: Partial<Record<Category, CategoryItem>> = {
  gym: 'dumbbell',
  reading: 'glasses',
  study: 'headphones',
  running: 'sneakers',
  water: 'bottle',
};

const MARKS: readonly Mark[] = ['medal', 'bandage'];

function pick<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((item) => item === value);
}

/** Reads the outfit column, dropping anything the drawing doesn't know. */
export function parseOutfit(value: unknown): Outfit {
  if (typeof value !== 'object' || value === null) return {};
  const outfit = value as Record<string, unknown>;
  return {
    head: pick(HEAD_ITEMS, outfit.head),
    neck: pick(NECK_ITEMS, outfit.neck),
    background: pick(BACKGROUND_ITEMS, outfit.background),
  };
}

/** Night on the device clock (22:00-07:00), when the critter sleeps (spec section 4). */
export function isNight(now: Date): boolean {
  const hour = now.getHours();
  return hour >= 22 || hour < 7;
}

export type CritterLook = HealthState | 'egg';

export function critterLook(critter: Pick<PackCritter, 'status' | 'health'>): CritterLook {
  return critter.status === 'egg' ? 'egg' : healthState(critter);
}

export function critterArt(
  critter: PackCritter,
  context: { category: Category; now: Date; mood?: number; cracking?: boolean },
): CritterArt {
  return {
    species: critter.species,
    color: critterColors[critter.color],
    stage: critter.stage,
    look: critterLook(critter),
    mood: context.mood,
    sleeping: isNight(context.now),
    cracking: context.cracking,
    outfit: parseOutfit(critter.outfit),
    marks: critter.marks.filter((mark): mark is Mark => MARKS.includes(mark as Mark)),
    categoryItem: stageRank(critter.stage) >= stageRank('kid') ? CATEGORY_ITEMS[context.category] : undefined,
  };
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
