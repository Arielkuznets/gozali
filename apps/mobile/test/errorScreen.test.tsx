import { ScrollView, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { ErrorScreen } from '@/components/ErrorScreen';

jest.mock('expo-router', () => ({ usePathname: () => '/pack/p1' }));
jest.mock('@/lib/reportError', () => ({ reportError: jest.fn() }));

function crashScreen() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ErrorScreen error={new Error('boom')} retry={async () => undefined} />);
  });
  return tree;
}

describe('the screen a crash leaves', () => {
  // Try again is its only way out, and the largest text sizes on a small phone push it below the window.
  it('scrolls', () => {
    expect(crashScreen().root.findAllByType(ScrollView)).toHaveLength(1);
  });

  it('lets its text grow to twice its size and no more', () => {
    const sizes = crashScreen()
      .root.findAllByType(Text)
      .map((text) => text.props.maxFontSizeMultiplier);
    expect(sizes).toEqual([2, 2, 2]);
  });
});
