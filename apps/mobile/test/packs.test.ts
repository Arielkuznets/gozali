import { countedToday, currentMembers, type Pack, type PackMember } from '@/features/packs/api';

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
