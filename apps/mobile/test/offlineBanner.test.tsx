import { useNetInfo, type NetInfoState } from '@react-native-community/netinfo';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { AppText } from '@/components/AppText';
import { OfflineBanner } from '@/components/OfflineBanner';

jest.mock('@react-native-community/netinfo', () => ({ useNetInfo: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const OFFLINE = "You're offline. Feeds wait until the app is open online.";

/** The banner's text on a network NetInfo describes like this. */
function bannerOn(network: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) {
  jest.mocked(useNetInfo).mockReturnValue(network as NetInfoState);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<OfflineBanner />);
  });
  return tree.root.findAllByType(AppText).map((text) => text.props.children);
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
