import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { FeedList } from '@/features/feeds/FeedList';
import type { PackEvent } from '@/features/social/api';

jest.mock('@/features/feeds/PhotoViewer', () => ({ PhotoViewer: () => null }));

const UNLOCKED: PackEvent = { id: 'event', kind: 'achievement', actor_id: null, payload: { key: 'streak_7' }, created_at: '2026-11-01T10:00:00Z' };
const NEW_ITEM = '🏆 Mochi unlocked One week strong: a new beanie for the wardrobe';
const NOTHING_NEW = '🏆 Mochi unlocked One week strong';

function textOf(events: PackEvent[], bought?: Set<string>, names = new Map<string, string | null>()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FeedList
        feeds={[]}
        events={events}
        bought={bought}
        names={names}
        critterName="Mochi"
        emoji="🐾"
        today="Sun Nov 01 2026"
        someoneFed={false}
        userId="me"
        onReact={jest.fn()}
        onMore={jest.fn()}
      />,
    );
  });
  return tree.root.findAll((node) => node.type === 'Text').map((node) => [node.props.children].flat().join(''));
}

describe('an achievement in the feed', () => {
  it('brings a new item when the pack never bought it', () => {
    expect(textOf([UNLOCKED], new Set(['cap']))).toEqual([NEW_ITEM]);
  });

  it('brings nothing new when the pack bought that item first', () => {
    expect(textOf([UNLOCKED], new Set(['beanie']))).toEqual([NOTHING_NEW]);
  });

  it('promises nothing new before it is known what the pack bought', () => {
    expect(textOf([UNLOCKED])).toEqual([NOTHING_NEW]);
  });
});

describe('a joker in the feed', () => {
  // The line stays in the feed after its day closes, among the photos of later days.
  it('reads true on the days after the joker', () => {
    const joker: PackEvent = { id: 'joker', kind: 'joker', actor_id: 'dan', payload: { day: '2026-10-29' }, created_at: '2026-10-29T07:00:00Z' };
    expect(textOf([joker], undefined, new Map([['dan', 'Dan']]))).toEqual(['🃏 Dan took a joker']);
  });
});

describe('a line of a member whose account is gone', () => {
  // A deleted account leaves its lines with no actor.
  it('says Someone, while a name still on its way shows as …', () => {
    const events: PackEvent[] = [
      { id: 'joined', kind: 'joined', actor_id: null, payload: {}, created_at: '2026-10-30T10:00:00Z' },
      { id: 'bought', kind: 'bought', actor_id: null, payload: { item: 'bow' }, created_at: '2026-10-29T10:00:00Z' },
      { id: 'named', kind: 'named', actor_id: 'noa', payload: { name: 'Kit' }, created_at: '2026-10-28T10:00:00Z' },
    ];
    expect(textOf(events)).toEqual(['👋 Someone joined the pack', '🛍️ Someone bought Mochi a bow', '🏷️ … named the pet Kit']);
  });
});
