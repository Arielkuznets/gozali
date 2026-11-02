import { Image } from 'expo-image';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import type { FeedItem } from '@/features/feeds/api';
import { FeedList } from '@/features/feeds/FeedList';

jest.mock('@/features/feeds/PhotoViewer', () => ({ PhotoViewer: () => null }));

const item = (photoUrl: string | null): FeedItem => ({
  id: 'feed',
  pack_id: 'pack',
  user_id: 'friend',
  photo_path: 'pack/friend/photo.jpg',
  caption: null,
  day: '2026-11-01',
  is_extra: false,
  focus_minutes: null,
  created_at: '2026-11-01T10:00:00Z',
  photoUrl,
  reactions: [],
});

const list = (photoUrl: string | null) => (
  <FeedList
    feeds={[item(photoUrl)]}
    events={[]}
    names={new Map([['friend', 'Dan']])}
    critterName="Mochi"
    emoji="🐾"
    now={new Date('2026-11-01T11:00:00Z')}
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

    act(() => tree.update(list(null)));

    expect(tree.root.findAllByType(Image)).toHaveLength(0);
  });
});
