import { Stack, router, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import FeedScreen from '@/app/(app)/pack/[id]/feed';

// The real router and the real camera screen, in a stack set up like the app's. A tapped
// notification pushes its screen over whatever is open, which leaves the camera screen mounted.
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path: string) => `gozali://${path}`,
  resolveScheme: () => 'gozali',
  addEventListener: () => ({ remove: () => undefined }),
}));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }] }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/days/api', () => ({ pauseToday: () => null, useDayStatus: () => ({ data: undefined }) }));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
jest.mock('@/features/feeds/api', () => ({ useSendFeed: () => ({ mutateAsync: async () => 'sent' }) }));
jest.mock('@/features/feeds/send', () => ({ compressPhoto: async () => 'file:///compressed.jpg' }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: jest.fn() }));
jest.mock('@/features/packs/api', () => ({ usePack: () => ({ data: { name: 'Gym squad' }, isLoading: false }) }));

const routes = {
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/_layout': {
    default: () => (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="pack/[id]/feed" options={{ presentation: 'fullScreenModal' }} />
      </Stack>
    ),
    unstable_settings: { initialRouteName: 'index' },
  },
  '(app)/index': { default: () => <Text>home</Text> },
  '(app)/pack/[id]/index': { default: () => <Text>pack</Text> },
  '(app)/pack/[id]/feed': { default: FeedScreen },
};

const CAMERA = '/pack/p1/feed';
const OTHER_PACK = '/pack/p2';

let app: ReactTestRenderer;

async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
  }
}

async function go(move: () => void) {
  await act(async () => move());
  await settle();
}

async function openCamera() {
  await act(async () => {
    app = create(<ExpoRoot context={getMockContext(routes as never)} location="/" />, {
      createNodeMock: (element) =>
        element.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: 'file:///shot.jpg', width: 1000 }) } : null,
    });
  });
  await settle();
  await go(() => router.push(CAMERA as Href));
}

const pathname = () => store.getRouteInfo().pathname;
const cameras = () => app.root.findAll((node) => node.type === 'CameraView');
const shutter = () =>
  app.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'Take photo')[0];
const cameraReady = () => act(async () => cameras()[0]?.props.onCameraReady());
const press = async (name: string) => {
  await act(async () =>
    app.root
      .findAll((node) => (node.props.accessibilityLabel === name || node.props.label === name) && node.props.onPress)[0]
      ?.props.onPress(),
  );
  await settle();
};

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
});

afterEach(async () => {
  await act(async () => app.unmount());
  jest.useRealTimers();
});

describe('a screen opened over the camera', () => {
  it('takes the camera down, and brings it back on the way back', async () => {
    await openCamera();
    expect(cameras().length).toBe(1);

    await go(() => router.push(OTHER_PACK as Href));
    expect(pathname()).toBe(OTHER_PACK);
    expect(cameras().length).toBe(0);

    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);
    expect(cameras().length).toBe(1);
  });

  it('leaves one camera running when that screen is a second camera', async () => {
    await openCamera();

    await go(() => router.push('/pack/p2/feed' as Href));
    expect(cameras().length).toBe(1);
  });

  it('keeps the shutter off until the camera that came back is ready', async () => {
    await openCamera();
    await cameraReady();
    expect(shutter()?.props.accessibilityState.disabled).toBe(false);

    await go(() => router.push(OTHER_PACK as Href));
    await go(() => router.back());
    expect(shutter()?.props.accessibilityState.disabled).toBe(true);

    await cameraReady();
    expect(shutter()?.props.accessibilityState.disabled).toBe(false);
  });

  it('waits for it to close before the sent screen closes itself', async () => {
    await openCamera();
    await cameraReady();
    await press('Take photo');
    await press('Send');

    await go(() => router.push(OTHER_PACK as Href));
    await settle();
    expect(pathname()).toBe(OTHER_PACK);

    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);

    await settle();
    await settle();
    expect(pathname()).toBe('/');
  });
});
