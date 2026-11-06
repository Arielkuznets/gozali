import { countedToday, currentMembers, restDaysOn, type Pack, type PackMember } from '@/features/packs/api';

const member = (user_id: string, status: PackMember['status'], joined_at: string): PackMember => ({
  user_id,
  role: 'member',
  status,
  joined_at,
  profiles: null,
});

const pack = {
  pack_members: [
    member('dan', 'active', '2026-09-02T10:00:00Z'),
    member('noa', 'active', '2026-09-01T10:00:00Z'),
    member('maya', 'sleeping', '2026-09-03T10:00:00Z'),
    member('eli', 'left', '2026-09-04T10:00:00Z'),
    member('tom', 'active', '2026-09-05T10:00:00Z'),
  ],
} as Pack;

describe('pack members', () => {
  it('lists who is in the pack, first to join first', () => {
    expect(currentMembers(pack).map((m) => m.user_id)).toEqual(['noa', 'dan', 'maya', 'tom']);
  });

  it('counts today everyone but the asleep and the paused', () => {
    expect(countedToday(pack, new Set(['tom'])).map((m) => m.user_id)).toEqual(['noa', 'dan']);
  });
});

describe('the rest days in force on a day', () => {
  const settings = { rest_days_per_week: 1, pending_rest_days_per_week: 3, pending_from: '2026-11-08' };

  it("are the pack's own without a change waiting", () => {
    expect(restDaysOn({ ...settings, pending_rest_days_per_week: null, pending_from: null }, '2026-11-08')).toBe(1);
  });

  it('are the old ones before the first day of a change', () => {
    expect(restDaysOn(settings, '2026-11-07')).toBe(1);
  });

  it('are the new ones from that day on', () => {
    expect(restDaysOn(settings, '2026-11-08')).toBe(3);
    expect(restDaysOn(settings, '2026-11-20')).toBe(3);
  });

  it('can be no rest days at all', () => {
    expect(restDaysOn({ ...settings, pending_rest_days_per_week: 0 }, '2026-11-08')).toBe(0);
  });
});
