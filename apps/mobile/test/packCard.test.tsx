import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { PackCard } from '@/components/PackCard';
import type { Pack, PackCritter, PackMember } from '@/features/packs/api';

jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/days/api', () => ({ useTodayPasses: () => ({ data: undefined }) }));
jest.mock('@/features/feeds/api', () => ({ feedWaitsToday: () => false, usePendingFeeds: () => ({ data: undefined }) }));

const WAITING = 'Waiting for a friend to join.';

const member = (user_id: string, status: PackMember['status'] = 'active'): PackMember => ({
  user_id,
  role: 'member',
  status,
  joined_at: '2026-10-01T10:00:00Z',
  profiles: null,
});
const noa = member('noa');
const dan = member('dan');
const danLeft = member('dan', 'left');

const critter = (status: PackCritter['status']): PackCritter => ({
  species: 'kit',
  name: 'Pixel',
  health: status === 'egg' ? 70 : 64,
  xp: 0,
  stage: status === 'egg' ? 'egg' : 'baby',
  status,
  streak: 0,
  coins: 0,
  marks: [],
  outfit: {},
});

const pack = (pack_members: PackMember[], critters: PackCritter | null): Pack => ({
  id: 'p',
  name: 'Gym squad',
  category: 'gym',
  custom_habit: null,
  rest_days_per_week: 0,
  week_start: 'sunday',
  invite_code: 'ABCD1234',
  pending_rest_days_per_week: null,
  pending_week_start: null,
  pending_from: null,
  timezone: 'Asia/Jerusalem',
  critters,
  pack_members,
});

function card(shown: Pack): string {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <PackCard
        pack={shown}
        now={new Date('2026-10-29T10:00:00Z')}
        fed={new Set()}
        userId="noa"
        onPress={() => undefined}
        onFeed={() => undefined}
      />,
    );
  });
  return JSON.stringify(tree.toJSON());
}

describe('the line on a pack card', () => {
  it('counts the day for a pet left with one member, whose days go on closing', () => {
    const text = card(pack([noa, danLeft], critter('active')));
    expect(text).toContain('0/1 fed today');
    expect(text).not.toContain(WAITING);
  });

  it('does that for a pet that ran away too: a good day counts toward bringing it back', () => {
    const text = card(pack([noa, danLeft], critter('ran_away')));
    expect(text).toContain('0/1 fed today');
    expect(text).not.toContain(WAITING);
  });

  it('counts the day for two members, on an egg or a pet', () => {
    expect(card(pack([noa, dan], critter('egg')))).toContain('0/2 fed today');
    expect(card(pack([noa, dan], critter('active')))).toContain('0/2 fed today');
  });

  it('waits for a friend on an egg, alone from the start or left alone', () => {
    expect(card(pack([noa], critter('egg')))).toContain(WAITING);
    expect(card(pack([noa, danLeft], critter('egg')))).toContain(WAITING);
  });

  it('waits for a friend on a pack with no pet to show', () => {
    expect(card(pack([noa], null))).toContain(WAITING);
  });
});
