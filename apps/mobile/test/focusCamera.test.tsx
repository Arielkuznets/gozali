import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, router, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import * as AppLayout from '@/app/(app)/_layout';
import FeedScreen from '@/app/(app)/pack/[id]/feed';
import FocusScreen from '@/app/(app)/pack/[id]/focus';
import type { FocusSession } from '@/features/focus/session';

// The real router, focus timer and camera screen, in the app's own stack.
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path: string) => `gozali://${path}`,
  resolveScheme: () => 'gozali',
  addEventListener: () => ({ remove: () => undefined }),
}));
const mockGet = jest.fn();
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.requireActual('expo-modules-core').createPermissionHook({
    getMethod: () => mockGet(),
    requestMethod: () => Promise.reject(new Error('These tests have their answer already')),
  }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
const mockCancelNotification = jest.fn();
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: async (id: string) => mockCancelNotification(id),
}));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/days/api', () => ({ pauseToday: () => null, useDayStatus: () => ({ data: undefined }) }));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
jest.mock('@/features/feeds/api', () => ({ useFeedQueue: () => undefined, useSendFeed: () => ({ mutateAsync: async () => 'sent' }) }));
jest.mock('@/features/feeds/send', () => ({ compressPhoto: async (uri: string) => uri }));
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({
    data: { name: 'Study group', category: 'study', critters: null },
    isPending: false,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@/features/profile/useProfile', () => ({ useAccountSync: () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ useWidgetSync: () => undefined }));
jest.mock('@/lib/haptics', () => ({ haptics: { bump: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/notifications', () => ({ allowNotifications: async () => true, useNotificationRoutes: () => undefined }));

const routes = {
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/_layout': AppLayout,
  '(app)/index': { default: () => <Text>home</Text> },
  '(app)/pack/[id]/index': { default: () => <Text>pack</Text> },
  '(app)/pack/[id]/focus': { default: FocusScreen },
  '(app)/pack/[id]/feed': { default: FeedScreen },
  '(app)/pack/[id]/not-today': { default: () => <Text>not today</Text> },
};

const PACK = '/pack/p1';
const FOCUS = '/pack/p1/focus';
const CAMERA = '/pack/p1/feed';
const STORAGE_KEY = 'gozali.focus';
const MINUTE = 60_000;
const DONE = 'Done, take the photo';
const CAMERA_NEEDED = 'Camera needed';
const NO_SESSION = 'Pick a length';

const answer = (status: string, canAskAgain: boolean) => ({ status, canAskAgain, granted: status === 'granted', expires: 'never' });
const allowed = answer('granted', true);
const refused = answer('denied', false);

let app: ReactTestRenderer;
const appStates = new Set<(state: AppStateStatus) => void>();

async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
  }
}

async function go(move: () => void) {
  await act(async () => move());
  await settle();
}

/** A session with this many minutes on its clock, stored as the phone holds one. */
async function keepSession(minutes: number, session: Partial<FocusSession> = {}) {
  const stored: FocusSession = {
    packId: 'p1',
    minutes: 25,
    startedAt: Date.now() - minutes * MINUTE,
    pausedAt: null,
    pausedMs: 0,
    notificationId: null,
    ...session,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

async function openPack() {
  await act(async () => {
    app = create(<ExpoRoot context={getMockContext(routes as never)} location="/" />, {
      createNodeMock: (element) =>
        element.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: 'file:///shot.jpg', width: 1000 }) } : null,
    });
  });
  await settle();
  await go(() => router.push(PACK as Href));
}

const pathname = () => store.getRouteInfo().pathname;
const shown = () => JSON.stringify(app.toJSON());
const cameras = () => app.root.findAll((node) => node.type === 'CameraView');
const press = async (name: string) => {
  await act(async () =>
    app.root
      .findAll((node) => (node.props.accessibilityLabel === name || node.props.label === name) && node.props.onPress)[0]
      ?.props.onPress(),
  );
  await settle();
};

async function takeAndSend() {
  await act(async () => cameras()[0]?.props.onCameraReady());
  await press('Take photo');
  await press('Send');
}

beforeEach(async () => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  await AsyncStorage.clear();
  mockCancelNotification.mockClear();
  mockGet.mockReset().mockResolvedValue(allowed);
  appStates.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStates.add(listener);
    return { remove: () => appStates.delete(listener) };
  });
});

afterEach(async () => {
  await act(async () => app.unmount());
  jest.useRealTimers();
});

describe('a session whose time ran out with the screen open', () => {
  beforeEach(async () => {
    await keepSession(25.1);
  });

  it('goes to the camera with its minutes', async () => {
    await openPack();
    await go(() => router.push(FOCUS as Href));

    expect(pathname()).toBe(CAMERA);
    expect(cameras()).toHaveLength(1);
    expect(shown()).toContain('25 min');
  });

  it('opens its own camera over one of the same pack, whose photo stays', async () => {
    await openPack();
    await go(() => router.push(CAMERA as Href));
    await act(async () => cameras()[0]?.props.onCameraReady());
    await press('Take photo');
    await go(() => router.push(PACK as Href));
    await go(() => router.push(FOCUS as Href));

    expect(pathname()).toBe(CAMERA);
    expect(cameras()).toHaveLength(1);
    expect(shown()).toContain('25 min');

    await go(() => router.back());
    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);
    expect(cameras()).toHaveLength(0);
    expect(shown()).toContain('Retake');
  });

  it('keeps its minutes when the camera is refused and left', async () => {
    mockGet.mockResolvedValue(refused);
    await openPack();
    await go(() => router.push(FOCUS as Href));
    expect(shown()).toContain(CAMERA_NEEDED);

    await press('Close');
    expect(pathname()).toBe(PACK);

    mockGet.mockResolvedValue(allowed);
    await go(() => router.push(FOCUS as Href));
    expect(pathname()).toBe(FOCUS);

    await press(DONE);
    expect(pathname()).toBe(CAMERA);
    expect(cameras()).toHaveLength(1);
    expect(shown()).toContain('25 min');
  });

  it('keeps its minutes through a yes in the phone settings', async () => {
    mockGet.mockResolvedValue(refused);
    await openPack();
    await go(() => router.push(FOCUS as Href));

    mockGet.mockResolvedValue(allowed);
    await act(async () => appStates.forEach((listener) => listener('active')));
    await settle();

    expect(cameras()).toHaveLength(1);
    expect(shown()).toContain('25 min');
  });
});

describe('a session whose time runs out under another screen', () => {
  const OTHER_PACK = '/pack/p2';

  beforeEach(async () => {
    await keepSession(24.8);
    await openPack();
    await go(() => router.push(FOCUS as Href));
  });

  it('leaves the photo on a camera over it', async () => {
    await go(() => router.push(CAMERA as Href));
    await act(async () => cameras()[0]?.props.onCameraReady());
    await press('Take photo');

    await go(() => jest.advanceTimersByTime(MINUTE));

    expect(shown()).toContain('Retake');
    expect(store.getRouteInfo().params.focus).toBeUndefined();
  });

  it('leaves a pack opened over it', async () => {
    await go(() => router.push(OTHER_PACK as Href));

    await go(() => jest.advanceTimersByTime(MINUTE));

    expect(pathname()).toBe(OTHER_PACK);
  });

  it('goes to the camera on the way back, within the minute after it ended', async () => {
    await go(() => router.push(OTHER_PACK as Href));
    await go(() => jest.advanceTimersByTime(30_000));

    await go(() => router.back());

    expect(pathname()).toBe(CAMERA);
    expect(shown()).toContain('25 min');
  });

  it('waits for Done on the way back after that', async () => {
    await go(() => router.push(OTHER_PACK as Href));
    await go(() => jest.advanceTimersByTime(2 * MINUTE));

    await go(() => router.back());

    expect(pathname()).toBe(FOCUS);
    expect(shown()).toContain(DONE);
  });
});

describe('Done, on a session that still has time', () => {
  it('stops the clock and the notice at the camera, and keeps both stopped when it is left', async () => {
    await keepSession(10, { notificationId: 'time-is-up' });
    await openPack();
    await go(() => router.push(FOCUS as Href));
    await press(DONE);
    expect(shown()).toContain('10 min');
    expect(mockCancelNotification).toHaveBeenCalledWith('time-is-up');

    await press('Close');
    await go(() => jest.advanceTimersByTime(30 * MINUTE));
    await go(() => router.push(FOCUS as Href));
    expect(shown()).toContain('Paused');

    await press(DONE);
    expect(shown()).toContain('10 min');
  });

  it('still reaches the camera when the phone fails to write', async () => {
    await keepSession(10);
    await openPack();
    await go(() => router.push(FOCUS as Href));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('database or disk is full'));

    await press(DONE);

    expect(pathname()).toBe(CAMERA);
    expect(shown()).toContain('10 min');
  });
});

describe('the photo that goes out', () => {
  it('ends the session', async () => {
    await keepSession(10);
    await openPack();
    await go(() => router.push(FOCUS as Href));
    await press(DONE);

    await takeAndSend();

    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    await settle();
    await settle();
    await settle();
    expect(pathname()).toBe(PACK);

    await go(() => router.push(FOCUS as Href));
    expect(shown()).toContain(NO_SESSION);
  });

  it('ends it on a timer left open under the camera, as a notification opens one', async () => {
    await keepSession(40);
    await openPack();
    await go(() => router.push(FOCUS as Href));
    expect(pathname()).toBe(FOCUS);
    await go(() => router.push(`${CAMERA}?focus=25` as Href));

    await takeAndSend();
    await settle();
    await settle();
    await settle();

    expect(pathname()).toBe(FOCUS);
    expect(shown()).toContain(NO_SESSION);
    expect(shown()).not.toContain(DONE);
  });

  it('leaves the session of another pack running, on an old link to the end of this one', async () => {
    await keepSession(10, { packId: 'p2', notificationId: 'p2-time-is-up' });
    await openPack();
    await go(() => router.push(`${CAMERA}?focus=25` as Href));

    await takeAndSend();

    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? 'null')).toMatchObject({ packId: 'p2', notificationId: 'p2-time-is-up' });
    expect(mockCancelNotification).not.toHaveBeenCalled();
  });
});
