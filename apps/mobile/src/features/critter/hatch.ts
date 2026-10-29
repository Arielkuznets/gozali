import { hatchIsCertain, type MemberDay } from '@gozali/game-engine';

import type { MembersToday, TodayPasses } from '@/features/days/api';
import type { PackMember } from '@/features/packs/api';

/**
 * Whether the egg hatches when today ends whatever the others do (hatchIsCertain), from what the
 * pack screen shows now and what only the server knows. Not knowing counts as not certain, and a
 * member the server didn't list yet as someone who could miss.
 */
export function hatchesTonight(
  members: readonly PackMember[],
  fed: ReadonlySet<string>,
  today: TodayPasses,
  known: MembersToday | undefined,
): boolean {
  if (!known) return false;
  const facts = new Map(known.members.map((member) => [member.userId, member]));
  const days = members.map((member): MemberDay => {
    const fact = facts.get(member.user_id);
    return {
      userId: member.user_id,
      membership: fact?.membership ?? member.status,
      hasStarted: fact?.hasStarted ?? true,
      paused: today.paused.has(member.user_id),
      fedToday: fed.has(member.user_id),
      jokerToday: today.passes.get(member.user_id) === 'joker',
      restDeclaredToday: today.passes.get(member.user_id) === 'rest',
      restDaysUsedThisWeek: fact?.restDaysUsedThisWeek ?? known.restDaysPerWeek,
      recentMisses: 0,
    };
  });
  return hatchIsCertain(days, known.restDaysPerWeek);
}
