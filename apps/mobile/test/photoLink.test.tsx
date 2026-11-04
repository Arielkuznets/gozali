import { Image } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { MemberCircles } from '@/components/MemberCircles';
import type { FeedItem } from '@/features/feeds/api';
import { FeedList } from '@/features/feeds/FeedList';

jest.mock('@/features/feeds/PhotoViewer', () => ({ PhotoViewer: () => null }));

const PATH = 'pack/friend/photo.jpg';

const item = (photoUrl: string | null, photo_path: string | null): FeedItem => ({
  id: 'feed',
  pack_id: 'pack',
  user_id: 'friend',
  photo_path,
  caption: null,
  day: '2026-11-01',
  is_extra: false,
  focus_minutes: null,
  created_at: '2026-11-01T10:00:00Z',
  photoUrl,
  reactions: [],
});

const list = (photoUrl: string | null, path: string | null = PATH) => (
  <FeedList
    feeds={[item(photoUrl, path)]}
    events={[]}
    names={new Map([['friend', 'Dan']])}
    critterName="Mochi"
    emoji="🐾"
    today="Sun Nov 01 2026"
    someoneFed={false}
    userId="me"
    onReact={jest.fn()}
    onMore={jest.fn()}
  />
);

const photo = (tree: ReactTestRenderer) => tree.root.findByType(Image).props;

describe('a feed photo when a refetch brings a new link', () => {
  let tree: ReactTestRenderer;

  beforeEach(() => {
    act(() => {
      tree = create(list('https://s/photo?token=first'));
    });
  });

  test('one that has loaded keeps its link, so it does not load and fade in again', () => {
    act(() => photo(tree).onLoad?.({ cacheType: 'disk' }));

    act(() => tree.update(list('https://s/photo?token=second')));

    expect(photo(tree).source).toEqual({ uri: 'https://s/photo?token=first', cacheKey: 'feed' });
  });

  test('one that loads again, as on a change of size, still keeps its link', () => {
    act(() => photo(tree).onLoad?.({ cacheType: 'disk' }));
    act(() => tree.update(list('https://s/photo?token=second')));

    act(() => photo(tree).onLoad?.({ cacheType: 'disk' }));

    expect(photo(tree).source).toEqual({ uri: 'https://s/photo?token=first', cacheKey: 'feed' });
  });

  test('one that has not loaded takes the new link, which is how a failed one tries again', () => {
    act(() => tree.update(list('https://s/photo?token=second')));

    expect(photo(tree).source).toEqual({ uri: 'https://s/photo?token=second', cacheKey: 'feed' });
  });

  test('one deleted after its 30 days goes, whatever link it loaded with', () => {
    act(() => photo(tree).onLoad?.({ cacheType: 'disk' }));

    act(() => tree.update(list(null, null)));

    expect(tree.root.findAllByType(Image)).toHaveLength(0);
  });
});

describe('a card with no link', () => {
  const KEPT = 'Photos are kept for 30 days.';
  const card = (photoUrl: string | null, path: string | null) => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(list(photoUrl, path));
    });
    return JSON.stringify(tree.toJSON());
  };

  test('says why, once the photo was deleted', () => {
    expect(card(null, null)).toContain(KEPT);
  });

  test('gives no reason when only the file is missing, at any age', () => {
    expect(card(null, PATH)).not.toContain(KEPT);
  });
});

// iOS decodes a photo at its full size unless it is told the size of its view first, and anyone in a
// pack can post a photo with more pixels than a phone has memory for.
describe("another member's photo", () => {
  test('is decoded at the size of its feed card', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(list('https://s/photo?token=first'));
    });

    expect(photo(tree).enforceEarlyResizing).toBe(true);
  });

  test('is decoded at the size of its member circle', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<MemberCircles members={[{ id: 'dan', name: 'Dan', state: 'fed', avatarUrl: 'https://s/dan.jpg?token=a' }]} color="#000" />);
    });

    expect(photo(tree).enforceEarlyResizing).toBe(true);
  });
});
