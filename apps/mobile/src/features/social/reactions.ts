import type { ReactionKey, ReactionTotal } from '@/features/social/api';

/**
 * A photo's reaction totals after the member picks `emoji`, or takes theirs back with null:
 * one reaction per member, so the old one goes first. Shown at once, before the server answers.
 */
export function withMyReaction(totals: ReactionTotal[], emoji: ReactionKey | null): ReactionTotal[] {
  const without = totals
    .map((total) => (total.mine ? { ...total, total: total.total - 1, mine: false } : total))
    .filter((total) => total.total > 0);
  if (emoji === null) return without;
  const existing = without.find((total) => total.emoji === emoji);
  return existing
    ? without.map((total) => (total.emoji === emoji ? { ...total, total: total.total + 1, mine: true } : total))
    : [...without, { emoji, total: 1, mine: true, names: [] }];
}
