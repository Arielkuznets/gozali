import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { AvatarButton } from '@/features/profile/AvatarButton';

// The real button and menu, over what the system's pickers answer.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  const chain = { duration: () => chain, easing: () => chain };
  return { __esModule: true, default: { View }, Easing: { out: () => undefined }, SlideInDown: chain };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@/lib/supabase', () => ({ supabase: null, requireSupabase: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/profile/useProfile', () => ({ useProfile: () => ({ data: { avatar_path: null } }) }));

const picker = jest.mocked(ImagePicker);
let tree: ReactTestRenderer;

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const textOf = (node: ReactTestInstance) => node.findAll((child) => child.type === 'Text').flatMap((child) => child.props.children);
const alerts = () => jest.mocked(Alert.alert).mock.calls.map(([message]) => message);

async function choose(label: string) {
  await act(async () =>
    tree.root.findAll((node) => node.props.accessibilityLabel === 'Profile photo' && node.props.onPress)[0]?.props.onPress(),
  );
  const rows = tree.root.findAll((node) => node.props.accessibilityRole === 'menuitem' && typeof node.props.onPress === 'function');
  await act(async () => rows.find((row) => textOf(row).includes(label))?.props.onPress());
  await settle();
}

beforeEach(async () => {
  // iOS runs a menu's choice when the native sheet is gone, and nothing here draws one.
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true } as ImagePicker.CameraPermissionResponse);
  await act(async () => {
    tree = create(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } })}>
        <AvatarButton name="Noa" />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => tree.unmount());
  jest.restoreAllMocks();
});

describe('a picker that fails to open', () => {
  it("says the camera didn't open, not that saving failed", async () => {
    picker.launchCameraAsync.mockRejectedValue(new Error('No Activity found to handle Intent'));
    await choose('Take a photo');

    expect(alerts()).toEqual(["The camera didn't open. You can choose a photo from your library instead."]);
  });

  it("says the library didn't open, not that saving failed", async () => {
    picker.launchImageLibraryAsync.mockRejectedValue(new Error('The picker failed'));
    await choose('Choose from library');

    expect(alerts()).toEqual(["Your photo library didn't open. Please try again."]);
  });
});
