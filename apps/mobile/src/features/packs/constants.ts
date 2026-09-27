import { CREATURES } from '@gozali/critter-art';

/** Habit categories with the default rest days from spec section 3. */
export const CATEGORIES = [
  { key: 'gym', emoji: '🏋️', defaultRestDays: 3 },
  { key: 'running', emoji: '🏃', defaultRestDays: 3 },
  { key: 'study', emoji: '📚', defaultRestDays: 1 },
  { key: 'reading', emoji: '📖', defaultRestDays: 0 },
  { key: 'water', emoji: '💧', defaultRestDays: 0 },
  { key: 'custom', emoji: '✨', defaultRestDays: 1 },
] as const;

export type Category = (typeof CATEGORIES)[number]['key'];

/** The six creatures a pack can raise, each with its own color and personality. */
export const SPECIES = CREATURES;
export type Species = (typeof SPECIES)[number];

export type CritterStage = 'egg' | 'baby' | 'kid' | 'teen' | 'adult' | 'legend';
export type CritterStatus = 'egg' | 'active' | 'ran_away';
export type WeekStart = 'sunday' | 'monday';

export const PACK_NAME_MAX = 30;
export const CUSTOM_HABIT_MAX = 40;
export const REST_DAYS_MAX = 4;
export const PACK_SIZE_MAX = 8;
export const INVITE_CODE_LENGTH = 8;

export function categoryInfo(key: Category) {
  return CATEGORIES.find((category) => category.key === key) ?? CATEGORIES[CATEGORIES.length - 1];
}

/** The public invite link; the landing page behind it comes with the domain (spec section 14). */
export function inviteLink(code: string): string {
  return `https://gozali.app/i/${code}`;
}

/** Invite codes use letters and digits without look-alikes, always upper case. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '').slice(0, INVITE_CODE_LENGTH);
}
