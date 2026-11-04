import { ScrollView, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { ErrorScreen } from '@/components/ErrorScreen';
import { reportError } from '@/lib/reportError';

let mockPathname: string;
jest.mock('expo-router', () => ({ usePathname: () => mockPathname }));
jest.mock('@/lib/reportError', () => ({ reportError: jest.fn() }));

const error = new Error('boom');
const retry = async () => undefined;

function crashScreen() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<ErrorScreen error={error} retry={retry} />);
  });
  return tree;
}

beforeEach(() => {
  mockPathname = '/pack/p1';
  jest.mocked(reportError).mockClear();
});

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

describe('the report of a crash', () => {
  // The crash screen takes the place of the stack under it, which then forgets its screens.
  it('goes once, for the screen that crashed, as the path turns to the home screen', () => {
    const tree = crashScreen();
    mockPathname = '/';
    act(() => tree.update(<ErrorScreen error={error} retry={retry} />));

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(error, '/pack/p1');
  });
});
