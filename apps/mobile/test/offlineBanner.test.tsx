import { useNetInfo, type NetInfoState } from '@react-native-community/netinfo';
import { StyleSheet, type ViewStyle } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { AppText } from '@/components/AppText';
import { OfflineBanner } from '@/components/OfflineBanner';

jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: jest.fn() }));
let mockTopInset = 0;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: mockTopInset, bottom: 0, left: 0, right: 0 }),
}));

const OFFLINE = "You're offline. Feeds wait until the app is open online.";

function render(network: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) {
  jest.mocked(useNetInfo).mockReturnValue(network as NetInfoState);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<OfflineBanner />);
  });
  return tree;
}

/** The banner's text on a network NetInfo describes like this. */
function bannerOn(network: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) {
  return render(network).root.findAllByType(AppText).map((text) => text.props.children);
}

describe('the offline banner', () => {
  it('shows on a network with no way to the internet, as on a hotel Wi-Fi', () => {
    expect(bannerOn({ isConnected: true, isInternetReachable: false })).toEqual([OFFLINE]);
  });

  it('shows with no network at all', () => {
    expect(bannerOn({ isConnected: false, isInternetReachable: false })).toEqual([OFFLINE]);
  });

  it("stays away while it isn't known yet whether the internet can be reached", () => {
    expect(bannerOn({ isConnected: true, isInternetReachable: null })).toEqual([]);
  });
});

describe('the place of the offline banner', () => {
  afterEach(() => {
    mockTopInset = 0;
  });

  // Each screen pads its own top by the status bar's inset, and the banner comes before the screens.
  it('takes its own room above the screens, and hands back the inset they pad themselves', () => {
    mockTopInset = 47;
    const banner = render({ isConnected: false, isInternetReachable: false }).root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityLiveRegion === 'polite',
    )[0]!;
    const style = StyleSheet.flatten(banner.props.style) as ViewStyle;

    expect(style.position).not.toBe('absolute');
    expect(style.paddingTop).toBeGreaterThan(47);
    expect(style.marginBottom).toBe(-47);
  });
});
