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

const SPECIES_NAMES: Record<CritterRow['species'], string> = {
  mochi: 'Mochi',
  kit: 'Kit',
  axo: 'Axo',
  ribbit: 'Ribbit',
  hoot: 'Hoot',
  bun: 'Bun',
};

/** `day` is the owner's calendar day (YYYY-MM-DD), for the holiday hat. */
export function widgetPack(row: WidgetPackRow, day?: string): WidgetPack {
  const fed = row.members.filter((mark) => mark === 'fed').length;
  const total = row.members.filter((mark) => mark !== 'away').length;
  const context = { category: row.category, mood: total > 0 ? fed / total : 0, cracking: row.daysRunning, day };
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

/**
 * A short, stable id for a drawing, so widgets can cache images by URL. It hashes the SVG and not
 * the art, whose mood moves with every feed while the picture changes at only a few of them.
 */
export function artVersion(art: CritterArt): string {
  let hash = 0x811c9dc5;
  for (const char of renderCritter(art)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * A calendar day in a time zone, YYYY-MM-DD (the en-CA format is already in that order). The zone
 * is the phone's, and a phone's list can hold names this Intl doesn't know. The day only picks a
 * holiday hat, so the day in UTC does then.
 */
export function dayIn(timeZone: string, at: Date): string {
  const inZone = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  try {
    return inZone(timeZone);
  } catch {
    return inZone('UTC');
  }
}

export function artSvg(art: CritterArt): string {
  return renderCritter(art);
}
