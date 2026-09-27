// The widget payload (spec section 9): numbers and the critter, never photos or member names.
// Plain TypeScript shared by the Edge Function, the app (to write the same shape into the
// widgets' storage) and the tests.
import {
  critterArtFor,
  renderCritter,
  type CritterArt,
  type CritterRow,
  type HabitCategory,
} from '../../../packages/critter-art/src/index.ts';

export type MemberMark = 'fed' | 'pass' | 'away' | 'waiting';

/** One pack as widget_state returns it. */
export interface WidgetPackRow {
  id: string;
  name: string;
  category: HabitCategory;
  dayEndsAt: string;
  daysRunning: boolean;
  critter: CritterRow & { name: string | null; streak: number };
  iFed: boolean;
  members: MemberMark[];
}

/** One pack as a widget shows it. */
export interface WidgetPack {
  id: string;
  name: string;
  critterName: string;
  health: number;
  status: CritterRow['status'];
  streak: number;
  fed: number;
  /** Members counted today: everyone not asleep or paused. */
  total: number;
  iFed: boolean;
  members: MemberMark[];
  dayEndsAt: string;
  /** Screen reader text for the critter, like "Pixel is hungry, health 45". */
  label: string;
  art: CritterArt;
  nightArt: CritterArt;
}

const SPECIES_NAMES = { blob: 'Blob', spark: 'Spark', mossy: 'Mossy' } as const;

export function widgetPack(row: WidgetPackRow): WidgetPack {
  const fed = row.members.filter((mark) => mark === 'fed').length;
  const total = row.members.filter((mark) => mark !== 'away').length;
  const context = { category: row.category, mood: total > 0 ? fed / total : 0, cracking: row.daysRunning };
  const art = critterArtFor(row.critter, { ...context, sleeping: false });
  const critterName = row.critter.name ?? SPECIES_NAMES[row.critter.species];
  const state = art.look === 'egg' ? 'an egg' : art.look === 'ran_away' ? 'away' : art.look;
  return {
    id: row.id,
    name: row.name,
    critterName,
    health: row.critter.health,
    status: row.critter.status,
    streak: row.critter.streak,
    fed,
    total,
    iFed: row.iFed,
    members: row.members,
    dayEndsAt: row.dayEndsAt,
    label: art.look === 'egg' || art.look === 'ran_away' ? `${critterName} is ${state}` : `${critterName} is ${state}, health ${row.critter.health}`,
    art,
    nightArt: critterArtFor(row.critter, { ...context, sleeping: true }),
  };
}

/** A short, stable id for a drawing, so widgets can cache images by URL. */
export function artVersion(art: CritterArt): string {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(art)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function artSvg(art: CritterArt): string {
  return renderCritter(art);
}
