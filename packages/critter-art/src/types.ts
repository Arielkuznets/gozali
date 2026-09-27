import type { HealthState, Mark, Stage } from '@gozali/game-engine';

/** The six creatures, each with its own look, color and personality (decision D19). */
export const CREATURES = ['mochi', 'kit', 'axo', 'ribbit', 'hoot', 'bun'] as const;
export type Creature = (typeof CREATURES)[number];

/** The name the database and the app use for the kind of critter. */
export type Species = Creature;

export const HEAD_ITEMS = ['beanie', 'flower_crown', 'sun_hat', 'headlamp', 'halo'] as const;
export const NECK_ITEMS = ['scarf', 'cape', 'bow_tie'] as const;
export const BACKGROUND_ITEMS = ['sunrise', 'park', 'party', 'space'] as const;

export type HeadItem = (typeof HEAD_ITEMS)[number];
export type NeckItem = (typeof NECK_ITEMS)[number];
export type BackgroundItem = (typeof BACKGROUND_ITEMS)[number];

export interface Outfit {
  head?: HeadItem;
  neck?: NeckItem;
  background?: BackgroundItem;
}

/** The habit item a critter carries from the Kid stage (spec section 4). */
export type CategoryItem = 'dumbbell' | 'glasses' | 'headphones' | 'sneakers' | 'bottle';

/** Everything the drawing depends on. The same input always gives the same SVG. */
export interface CritterArt {
  species: Species;
  /** Body color as hex: the creature's own (CREATURE_COLORS). */
  color: string;
  stage: Stage;
  /** 'egg' while not hatched; otherwise the health state, including 'ran_away'. */
  look: HealthState | 'egg';
  /** Share of today's counted members who already fed, 0 to 1. Everyone fed brightens the face. */
  mood?: number;
  /** Night on the device clock (22:00-07:00): closed eyes and a nightcap. */
  sleeping?: boolean;
  /** One animation frame with the eyes shut. */
  blinking?: boolean;
  /** An idle yawn: eyes squeezed shut and the mouth wide open. Not while asleep or sick. */
  yawning?: boolean;
  /** Where the eyes look, each axis from -1 to 1 (following a finger). */
  gaze?: { x: number; y: number };
  /** A holiday: the holiday hat takes the place of the head item (spec section 4). */
  holiday?: boolean;
  /** The egg shows a crack once the second member joined. */
  cracking?: boolean;
  outfit?: Outfit;
  marks?: readonly Mark[];
  categoryItem?: CategoryItem;
}
