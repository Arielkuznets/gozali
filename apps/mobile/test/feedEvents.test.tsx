import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { FeedList } from '@/features/feeds/FeedList';
import type { PackEvent } from '@/features/social/api';

jest.mock('@/features/feeds/PhotoViewer', () => ({ PhotoViewer: () => null }));

const UNLOCKED: PackEvent = { id: 'event', kind: 'achievement', actor_id: null, payload: { key: 'streak_7' }, created_at: '2026-11-01T10:00:00Z' };
const NEW_ITEM = '🏆 Mochi unlocked One week strong: a new beanie for the wardrobe';
const NOTHING_NEW = '🏆 Mochi unlocked One week strong';

function textOf(bought: Set<string> | undefined) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FeedList
        feeds={[]}
        events={[UNLOCKED]}
        bought={bought}
        names={new Map()}
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
    expect(textOf(new Set(['cap']))).toEqual([NEW_ITEM]);
  });

  it('brings nothing new when the pack bought that item first', () => {
    expect(textOf(new Set(['beanie']))).toEqual([NOTHING_NEW]);
  });

  it('promises nothing new before it is known what the pack bought', () => {
    expect(textOf(undefined)).toEqual([NOTHING_NEW]);
  });
});
