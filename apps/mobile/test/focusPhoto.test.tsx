import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import FeedScreen from '@/app/(app)/pack/[id]/feed';

// The real camera screen and focus timer, around a send that works.
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'pack-1', focus: '25' }),
  useIsFocused: () => true,
  useFocusEffect: jest.fn(),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/days/api', () => ({ isPausedToday: () => false, useDayStatus: () => ({ data: undefined }) }));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
const mockSend = jest.fn();
jest.mock('@/features/feeds/api', () => ({ useSendFeed: () => ({ mutateAsync: mockSend }) }));
jest.mock('@/features/feeds/send', () => ({
  compressPhoto: async (uri: string) => uri,
  feedErrorKey: () => 'feed.failed',
  isFinalRejection: () => false,
}));
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({
    data: { name: 'Study group', category: 'study', critters: { name: 'Mochi', species: 'kit' } },
    isLoading: false,
    refetch: jest.fn(),
  }),
}));
const mockNotify = jest.fn();
jest.mock('@/lib/confirm', () => ({ notify: (message: string) => mockNotify(message) }));
jest.mock('@/lib/haptics', () => ({ haptics: { bump: jest.fn(), success: jest.fn() } }));

let screen: ReactTestRenderer;

async function press(name: string) {
  const button = screen.root.findAll((node) => (node.props.accessibilityLabel === name || node.props.label === name) && node.props.onPress)[0];
  await act(async () => button.props.onPress());
}

afterEach(async () => {
  await act(async () => screen.unmount());
});

describe('the photo that ends a focus session', () => {
  it('reaches the sent screen, with nothing to say, when the phone fails to forget the session', async () => {
    mockSend.mockResolvedValue('sent');
    await act(async () => {
      screen = create(<FeedScreen />, {
        createNodeMock: (element) =>
          element.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: 'file:///shot.jpg', width: 1000 }) } : null,
      });
    });
    await act(async () => screen.root.findByType('CameraView' as never).props.onCameraReady());
    await press('Take photo');

    jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('database or disk is full'));
    await press('Send');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(JSON.stringify(screen.toJSON())).not.toContain('Send');
  });
});
