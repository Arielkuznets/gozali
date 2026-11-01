import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Modal } from 'react-native';

import '@/i18n';
import { ActionMenu } from '@/components/ActionMenu';
import { PhotoViewer, type ViewedPhoto } from '@/features/feeds/PhotoViewer';

jest.mock('@/components/ActionMenu', () => ({ ActionMenu: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'noa' } } }),
}));
jest.mock('@/features/social/moderation', () => ({
  useModeration: () => ({ photoMenu: (photo: { name: string }) => ({ title: photo.name, actions: [] }) }),
}));

const photo: ViewedPhoto = { id: 'feed-1', userId: 'dan', url: 'https://photo', caption: null, name: 'Dan' };

function viewer(shown: ViewedPhoto) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<PhotoViewer photo={shown} onClose={() => {}} />);
  });
  return tree;
}

const more = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'More');

describe('the menu of a photo on the whole screen', () => {
  // Native iOS presents a modal from the one around it, so a menu drawn beside the viewer never
  // appears there, and the web build can't show that.
  it('opens inside the viewer', () => {
    const tree = viewer(photo);
    expect(more(tree).length).toBeGreaterThan(0);
    const [outer] = tree.root.findAllByType(Modal);
    expect(outer?.findAllByType(ActionMenu)).toHaveLength(1);
  });

  it('is not offered on your own photo', () => {
    expect(more(viewer({ ...photo, userId: 'noa' }))).toHaveLength(0);
  });
});
