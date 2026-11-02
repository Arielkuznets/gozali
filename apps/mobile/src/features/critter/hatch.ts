import { closeDay, hatchIsCertain, type MemberDay } from '@gozali/game-engine';

import type { MembersToday, TodayPasses } from '@/features/days/api';
import type { PackMember } from '@/features/packs/api';

/**
 * Whether the egg hatches when today ends whatever the others do (hatchIsCertain), from what the
 * pack screen shows now and what only the server knows. Not knowing counts as not certain, and so
 * does a day before today that hasn't closed. The server's answer may be older than the feeds on
 * screen, so a feed today means started, and a member it didn't list joined after it. A member who
 * can't end their pause today stays out of it, as the close leaves them out whatever they do.
 */
export function hatchesTonight(
  members: readonly PackMember[],
  fed: ReadonlySet<string>,
  today: TodayPasses,
  known: MembersToday | undefined,
): boolean {
  if (!known || known.dayToClose) return false;
  const facts = new Map(known.members.map((member) => [member.userId, member]));
  const days = members
    .filter((member) => !today.pausedForSure.has(member.user_id))
    .map((member): MemberDay => {
      const fact = facts.get(member.user_id);
      return {
        userId: member.user_id,
        membership: fact?.membership ?? member.status,
        hasStarted: fed.has(member.user_id) || (fact?.hasStarted ?? false),
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

/**
 * Whether the close of the day that ended hatches the egg, by its own input and rules. Only a feed
 * can still reach an ended day, in the grace window, and that takes no hatch away.
 */
export function hatchesAtClose(known: MembersToday | undefined): boolean {
  if (!known?.dayToClose) return false;
  return closeDay(known.dayToClose).events.some((event) => event.type === 'hatched');
}
