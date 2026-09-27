import { healthState, stageRank, type Mark, type Stage } from '@gozali/game-engine';

import { CREATURE_COLORS } from './creatures.ts';
import { isHoliday } from './holidays.ts';
import { CRITTER_PALETTE, type CritterColor } from './palette.ts';
import {
  BACKGROUND_ITEMS,
  HEAD_ITEMS,
  NECK_ITEMS,
  isCreature,
  type CategoryItem,
  type CritterArt,
  type Outfit,
  type Species,
} from './types.ts';

/** A critters row as the database stores it. */
export interface CritterRow {
  species: Species;
  color: CritterColor;
  health: number;
  stage: Stage;
  status: 'egg' | 'active' | 'ran_away';
  marks: readonly string[];
  outfit: unknown;
}

export type HabitCategory = 'gym' | 'running' | 'study' | 'reading' | 'water' | 'custom';

/** The habit item a critter carries from the Kid stage; custom habits have none. */
const CATEGORY_ITEMS: Partial<Record<HabitCategory, CategoryItem>> = {
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

/** Night on a clock (22:00-07:00), when the critter sleeps (spec section 4). */
export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 7;
}

/**
 * The drawing input for a stored critter. The app, the widgets and the server all use this,
 * so the critter looks the same everywhere.
 */
export function critterArtFor(
  critter: CritterRow,
  context: {
    category: HabitCategory;
    mood?: number;
    sleeping?: boolean;
    cracking?: boolean;
    /** The local calendar day (YYYY-MM-DD), for the holiday hat. */
    day?: string;
  },
): CritterArt {
  return {
    species: critter.species,
    // A creature always wears its own color; the stored color is for the first three species.
    color: isCreature(critter.species) ? CREATURE_COLORS[critter.species] : CRITTER_PALETTE[critter.color],
    stage: critter.stage,
    look: critter.status === 'egg' ? 'egg' : healthState(critter),
    mood: context.mood,
    sleeping: context.sleeping,
    cracking: context.cracking,
    holiday: context.day ? isHoliday(context.day) : false,
    outfit: parseOutfit(critter.outfit),
    marks: critter.marks.filter((mark): mark is Mark => MARKS.includes(mark as Mark)),
    categoryItem: stageRank(critter.stage) >= stageRank('kid') ? CATEGORY_ITEMS[context.category] : undefined,
  };
}
