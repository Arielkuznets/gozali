import { Stack, router, type Href } from 'expo-router';
import { ExpoRoot } from 'expo-router/build/ExpoRoot';
import { store } from 'expo-router/build/global-state/router-store';
import { getMockContext } from 'expo-router/build/testing-library/mock-config';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import * as NativeIntent from '@/app/+native-intent';
import * as AppLayout from '@/app/(app)/_layout';
import FeedScreen from '@/app/(app)/pack/[id]/feed';

// The real router, the app's own stack and the real camera screen. A tapped notification pushes its
// screen over whatever is open, which leaves the camera screen mounted. A link reaches the router
// the way it does on a phone: through the listener on expo-linking.
let mockLinkListener: ((event: { url: string }) => void) | null = null;
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  createURL: (path: string) => `gozali://${path}`,
  resolveScheme: () => 'gozali',
  addEventListener: (_event: string, listener: (event: { url: string }) => void) => {
    mockLinkListener = listener;
    return { remove: () => undefined };
  },
}));
type Tap = { notification: { request: { content: { data: { url: string } } } } };
const mockTapListeners = new Set<(response: Tap) => void>();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getLastNotificationResponseAsync: async () => null,
  clearLastNotificationResponseAsync: async () => undefined,
  addNotificationResponseReceivedListener: (listener: (response: Tap) => void) => {
    mockTapListeners.add(listener);
    return { remove: () => mockTapListeners.delete(listener) };
  },
}));
jest.mock('@/lib/push', () => ({}));
jest.mock('expo-camera', () => ({ CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }] }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
let mockPausedPack: string | null = null;
jest.mock('@/features/days/api', () => ({
  pauseToday: (status: unknown) => (status === 'paused' ? { startsOn: '2026-11-01', endsOn: '2026-11-08' } : null),
  useDayStatus: (packId: string) => ({ data: packId === mockPausedPack ? 'paused' : undefined }),
}));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
let mockOutcome = 'sent';
type Feed = { packId: string; photoUri: string; caption: string | null; focusMinutes: number | null; extra: boolean };
const mockSent: Feed[] = [];
jest.mock('@/features/feeds/api', () => ({
  useFeedQueue: () => undefined,
  useSendFeed: () => ({
    mutateAsync: async (feed: Feed) => {
      mockSent.push(feed);
      return mockOutcome;
    },
  }),
}));
jest.mock('@/features/feeds/send', () => ({ compressPhoto: async (uri: string) => uri }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: jest.fn() }));
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({ data: { name: 'Gym squad', category: 'gym' }, isLoading: false }),
}));
jest.mock('@/features/profile/useProfile', () => ({ useAccountSync: () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ useWidgetSync: () => undefined }));

const routes = {
  '+native-intent': NativeIntent,
  _layout: { default: () => <Stack screenOptions={{ headerShown: false }} /> },
  '(app)/_layout': AppLayout,
  '(app)/index': { default: () => <Text>home</Text> },
  '(app)/pack/[id]/index': { default: () => <Text>pack</Text> },
  '(app)/pack/[id]/feed': { default: FeedScreen },
  '(app)/pack/[id]/not-today': { default: () => <Text>not today</Text> },
};

const CAMERA = '/pack/p1/feed';
const OTHER_PACK = '/pack/p2';
const OTHER_CAMERA = '/pack/p2/feed';
const OTHER_CAMERA_LINK = 'gozali://pack/p2/feed';
const SHOT = 'file:///shot.jpg';

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

async function start(location: string) {
  await act(async () => {
    app = create(<ExpoRoot context={getMockContext(routes as never)} location={location} />, {
      createNodeMock: (element) =>
        element.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: SHOT, width: 1000 }) } : null,
    });
  });
  await settle();
}

async function openCamera(camera = CAMERA) {
  await start('/');
  await go(() => router.push(camera as Href));
}

/** Each screen of the app's stack, as its route and its pack. */
const appStack = () =>
  store.state?.routes[0]?.state?.routes[0]?.state?.routes.map(({ name, params }) =>
    `${name} ${(params as { id?: string } | undefined)?.id ?? ''}`.trim(),
  );
const pathname = () => store.getRouteInfo().pathname;
const cameras = () => app.root.findAll((node) => node.type === 'CameraView');
const captions = () => app.root.findAllByType(TextInput).map((input) => input.props.value);
const shown = () => JSON.stringify(app.toJSON());
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

async function takePhoto(caption = '') {
  await cameraReady();
  await press('Take photo');
  await act(async () => app.root.findByType(TextInput).props.onChangeText(caption));
}

async function followLink(url: string) {
  await go(() => mockLinkListener?.({ url }));
}

async function tapNotification(url: string) {
  await go(() => mockTapListeners.forEach((listener) => listener({ notification: { request: { content: { data: { url } } } } })));
}

const questions = () => jest.mocked(Alert.alert).mock.calls.map(([title]) => title);
async function answer(style: AlertButton['style']) {
  const buttons = (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  await go(() => buttons.find((button) => button.style === style)?.onPress?.());
}

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  mockPausedPack = null;
  mockOutcome = 'sent';
  mockSent.length = 0;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => app.unmount());
  jest.mocked(Alert.alert).mockRestore();
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

    await go(() => router.push(OTHER_CAMERA as Href));
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

describe('a link to the camera of another pack', () => {
  it('opens that camera over the photo, which stays with its own pack', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await followLink(OTHER_CAMERA_LINK);

    expect(pathname()).toBe(OTHER_CAMERA);
    expect(cameras()).toHaveLength(1);

    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);
    expect(captions()).toEqual(['Leg day']);

    await press('Send');
    expect(mockSent).toEqual([expect.objectContaining({ packId: 'p1', photoUri: SHOT, caption: 'Leg day' })]);
  });

  it('keeps the photo that stood under a screen of that pack', async () => {
    await openCamera();
    await takePhoto();
    await go(() => router.push(OTHER_PACK as Href));

    await followLink(OTHER_CAMERA_LINK);

    expect(appStack()).toEqual(['index', 'pack/[id]/feed p1', 'pack/[id]/index p2', 'pack/[id]/feed p2']);
    expect(cameras()).toHaveLength(1);
  });

  it('opens that camera in the moment before the sent screen closes, and that screen waits for it', async () => {
    await openCamera();
    await takePhoto();
    await press('Send');

    await followLink(OTHER_CAMERA_LINK);
    await settle();
    await settle();
    await settle();
    expect(pathname()).toBe(OTHER_CAMERA);
    expect(cameras()).toHaveLength(1);

    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);
    await settle();
    await settle();
    expect(pathname()).toBe('/');
  });

  it('opens that camera instead of leaving Saved for later on screen', async () => {
    mockOutcome = 'queued';
    await openCamera();
    await takePhoto();
    await press('Send');

    await followLink(OTHER_CAMERA_LINK);

    expect(pathname()).toBe(OTHER_CAMERA);
    expect(cameras()).toHaveLength(1);
  });

  it('goes on to that pack when it is paused, and the photo stays where it was', async () => {
    mockPausedPack = 'p2';
    await openCamera();
    await takePhoto('Leg day');

    await followLink(OTHER_CAMERA_LINK);

    expect(appStack()).toEqual(['index', 'pack/[id]/feed p1', 'pack/[id]/index p2']);

    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);
    expect(captions()).toEqual(['Leg day']);
  });
});

describe('a camera link to a paused pack', () => {
  beforeEach(() => {
    mockPausedPack = 'p2';
  });

  it('goes back to that pack when it stands right underneath', async () => {
    await start('/');
    await go(() => router.push(OTHER_PACK as Href));

    await followLink(OTHER_CAMERA_LINK);

    expect(appStack()).toEqual(['index', 'pack/[id]/index p2']);
  });

  it('opens that pack in its place otherwise', async () => {
    await start('/');

    await followLink(OTHER_CAMERA_LINK);

    expect(appStack()).toEqual(['index', 'pack/[id]/index p2']);
  });
});

describe('a link to the camera that is open', () => {
  it('stays on it, with its photo', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await followLink('gozali://pack/p1/feed');

    expect(appStack()).toEqual(['index', 'pack/[id]/feed p1']);
    expect(captions()).toEqual(['Leg day']);
  });

  it('goes back to it from a screen opened over it', async () => {
    await openCamera();
    await takePhoto('Leg day');
    await go(() => router.push(OTHER_PACK as Href));

    await followLink('gozali://pack/p1/feed');

    expect(appStack()).toEqual(['index', 'pack/[id]/feed p1']);
    expect(captions()).toEqual(['Leg day']);
  });

  it('leaves it what it was opened for', async () => {
    await openCamera(`${CAMERA}?focus=25`);

    await followLink('gozali://pack/p1/feed');
    expect(shown()).toContain('25 min');

    await takePhoto();
    await press('Send');
    expect(mockSent).toEqual([expect.objectContaining({ packId: 'p1', focusMinutes: 25 })]);
  });

  it('leaves another photo the extra it is', async () => {
    await openCamera(`${CAMERA}?extra=1`);

    await followLink('gozali://pack/p1/feed');
    expect(shown()).toContain('Another photo');

    await takePhoto();
    await press('Send');
    expect(mockSent).toEqual([expect.objectContaining({ packId: 'p1', extra: true })]);
  });
});

describe('a link to another pack', () => {
  it('opens over the camera, and Back reaches the photo there', async () => {
    await start('/');
    await go(() => router.push('/pack/p1' as Href));
    await go(() => router.push(CAMERA as Href));
    await takePhoto('Leg day');

    await followLink('gozali://pack/p2');

    expect(appStack()).toEqual(['index', 'pack/[id]/index p1', 'pack/[id]/feed p1', 'pack/[id]/index p2']);

    await go(() => router.back());
    expect(pathname()).toBe(CAMERA);
    expect(captions()).toEqual(['Leg day']);
  });
});

describe('a link to the pack under a photo', () => {
  async function photoOverItsPack() {
    await start('/');
    await go(() => router.push('/pack/p1' as Href));
    await go(() => router.push(CAMERA as Href));
    await takePhoto('Leg day');
  }

  it('asks first, and Keep leaves the photo and its caption', async () => {
    await photoOverItsPack();

    await followLink('gozali://pack/p1');

    expect(appStack()).toEqual(['index', 'pack/[id]/index p1', 'pack/[id]/feed p1']);
    expect(questions()).toEqual(['Discard this photo?']);

    await answer('cancel');
    expect(appStack()).toEqual(['index', 'pack/[id]/index p1', 'pack/[id]/feed p1']);
    expect(captions()).toEqual(['Leg day']);
  });

  it('opens the pack on Discard', async () => {
    await photoOverItsPack();

    await followLink('gozali://pack/p1');
    await answer('destructive');

    expect(appStack()).toEqual(['index', 'pack/[id]/index p1']);
    expect(questions()).toHaveLength(1);
  });

  it('opens the pack with no question before a photo is taken', async () => {
    await start('/');
    await go(() => router.push('/pack/p1' as Href));
    await go(() => router.push(CAMERA as Href));

    await followLink('gozali://pack/p1');

    expect(appStack()).toEqual(['index', 'pack/[id]/index p1']);
    expect(questions()).toEqual([]);
  });

  it('asks for the photo of another pack that would go with it', async () => {
    await start('/');
    await go(() => router.push('/pack/p1' as Href));
    await go(() => router.push(OTHER_PACK as Href));
    await go(() => router.push(OTHER_CAMERA as Href));
    await takePhoto('Leg day');

    await followLink('gozali://pack/p1');

    expect(appStack()).toEqual(['index', 'pack/[id]/index p1', 'pack/[id]/index p2', 'pack/[id]/feed p2']);
    expect(questions()).toEqual(['Discard this photo?']);
  });

  it('asks for a photo under the screen in front', async () => {
    await photoOverItsPack();
    await tapNotification(OTHER_PACK);

    await followLink('gozali://pack/p1');

    expect(appStack()).toEqual(['index', 'pack/[id]/index p1', 'pack/[id]/feed p1', 'pack/[id]/index p2']);
    expect(questions()).toEqual(['Discard this photo?']);
  });
});

describe('Back on a photo', () => {
  it('asks first', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await go(() => router.back());

    expect(pathname()).toBe(CAMERA);
    expect(questions()).toEqual(['Discard this photo?']);
    expect(captions()).toEqual(['Leg day']);
  });

  it('closes the camera on Discard', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await go(() => router.back());
    await answer('destructive');

    expect(pathname()).toBe('/');
    expect(questions()).toHaveLength(1);
  });
});

describe("the camera's own ways out", () => {
  it('close it after Retake with no question', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await press('Retake');
    await press('Close');

    expect(pathname()).toBe('/');
    expect(questions()).toEqual([]);
  });

  it('close it after a send with no question', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await press('Send');
    await settle();
    await settle();
    await settle();

    expect(pathname()).toBe('/');
    expect(questions()).toEqual([]);
  });

  it('close Saved for later with no question', async () => {
    mockOutcome = 'queued';
    await openCamera();
    await takePhoto('Leg day');

    await press('Send');
    await press('Close');

    expect(pathname()).toBe('/');
    expect(questions()).toEqual([]);
  });
});

describe('a link that opens the app', () => {
  it('opens the camera over the home screen', async () => {
    await start(CAMERA);

    expect(pathname()).toBe(CAMERA);
    expect(cameras()).toHaveLength(1);
    expect(router.canGoBack()).toBe(true);
  });
});

describe('a notification for a camera', () => {
  it('opens over the camera of another pack, and Back reaches the photo there', async () => {
    await openCamera();
    await takePhoto('Leg day');

    await tapNotification(OTHER_CAMERA);

    expect(appStack()).toEqual(['index', 'pack/[id]/feed p1', 'pack/[id]/feed p2']);
    expect(cameras()).toHaveLength(1);

    await go(() => router.back());
    expect(captions()).toEqual(['Leg day']);
  });

  it('opens a new camera when that one stands under another screen, and moves nothing', async () => {
    await openCamera();
    await takePhoto('Leg day');
    await go(() => router.push(OTHER_PACK as Href));

    await tapNotification(CAMERA);

    expect(appStack()).toEqual(['index', 'pack/[id]/feed p1', 'pack/[id]/index p2', 'pack/[id]/feed p1']);
    expect(cameras()).toHaveLength(1);
  });
});
