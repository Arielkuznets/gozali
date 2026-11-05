import { CREATURES } from '@gozali/critter-art';

/** Habit categories with the default rest days from spec section 3. */
export const CATEGORIES = [
  { key: 'gym', emoji: '🏋️', defaultRestDays: 3 },
  { key: 'running', emoji: '🏃', defaultRestDays: 3 },
  { key: 'study', emoji: '📚', defaultRestDays: 1 },
  { key: 'reading', emoji: '📖', defaultRestDays: 0 },
  { key: 'water', emoji: '💧', defaultRestDays: 0 },
  { key: 'walking', emoji: '🚶', defaultRestDays: 1 },
  { key: 'yoga', emoji: '🧘', defaultRestDays: 2 },
  { key: 'meditation', emoji: '🪷', defaultRestDays: 0 },
  { key: 'eating', emoji: '🥗', defaultRestDays: 1 },
  { key: 'sleep', emoji: '😴', defaultRestDays: 1 },
  { key: 'language', emoji: '🗣️', defaultRestDays: 1 },
  { key: 'music', emoji: '🎸', defaultRestDays: 1 },
  { key: 'journal', emoji: '✍️', defaultRestDays: 1 },
  { key: 'custom', emoji: '✨', defaultRestDays: 1 },
] as const;

export type Category = (typeof CATEGORIES)[number]['key'];

/** Habits done in sittings, where the focus timer helps. */
export const FOCUS_CATEGORIES: ReadonlySet<Category> = new Set(['study', 'reading', 'meditation', 'language', 'music']);

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

/** A whole code, maybe split in the middle, as people write one. */
const CODE_SHAPE = '[a-hj-np-z2-9]{4}[- ]?[a-hj-np-z2-9]{4}(?![a-z0-9])';

/**
 * The code in what someone pasted: the invite message and the link carry it after "/i/" or
 * "Code:", a friend may write it among words of their own, and the letters of the rest would make
 * a wrong code. Anything else is the code itself.
 */
export function inviteCodeFrom(input: string): string {
  // Full-width letters and digits, as East Asian keyboards type them, become the plain ones.
  const text = input.normalize('NFKC');
  const found =
    /gozali(?:\.app|:\/)\/i\/([a-z0-9-]+)/i.exec(text) ?? new RegExp(`\\bcode\\s*[:=]\\s*(${CODE_SHAPE})`, 'i').exec(text);
  if (found) return normalizeInviteCode(found[1]!);
  // Every word that could be the code, overlapping ones too: "my pack KPQR 5678" has "pack KPQR".
  const words = [...text.matchAll(new RegExp(`(?:^|[^a-z0-9])(?=(${CODE_SHAPE}))`, 'gi'))].map((match) => match[1]!);
  // An English word can be made of the code's letters too (STRENGTH), so a word with a digit wins,
  // then one in capitals, as the app and its site show codes, then one in a piece, and the last one
  // otherwise, as in "my code is ...".
  const rank = (word: string) => (/[2-9]/.test(word) ? 4 : 0) + (word === word.toUpperCase() ? 2 : 0) + (/[- ]/.test(word) ? 0 : 1);
  const word = words.reduce<string | undefined>((best, next) => (best === undefined || rank(next) >= rank(best) ? next : best), undefined);
  return normalizeInviteCode(word ?? /\bcode\s*[:=]\s*([a-z0-9-]+)/i.exec(text)?.[1] ?? text);
}
