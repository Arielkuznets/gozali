import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import FeedScreen from '@/app/(app)/pack/[id]/feed';

// The real permission hook, over what the system answers.
const mockGet = jest.fn();
const mockRequest = jest.fn();
jest.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: jest.requireActual('expo-modules-core').createPermissionHook({
    getMethod: () => mockGet(),
    requestMethod: () => mockRequest(),
  }),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
const mockBack = jest.fn();
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useLocalSearchParams: () => ({ id: 'pack-1' }),
    useIsFocused: () => true,
    router: { canGoBack: () => true, back: () => mockBack(), replace: jest.fn(), dismissTo: (href: string) => mockDismissTo(href) },
    useFocusEffect: (run: () => void) => useEffect(run, [run]),
  };
});
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
let mockPause: { startsOn: string; endsOn: string } | null;
jest.mock('@/features/days/api', () => ({ pauseToday: () => mockPause, useDayStatus: () => ({ data: undefined }) }));
jest.mock('@/features/feeds/EatingMoment', () => ({ EatingMoment: () => null }));
const mockSend = jest.fn();
jest.mock('@/features/feeds/api', () => ({ useSendFeed: () => ({ mutateAsync: (feed: unknown) => mockSend(feed) }) }));
jest.mock('@/features/feeds/send', () => ({ compressPhoto: jest.fn(), isFinalRejection: () => false }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ haptics: { bump: jest.fn(), success: jest.fn() } }));
let mockPack: { data: unknown; isLoading: boolean; refetch: () => void };
jest.mock('@/features/packs/api', () => ({ usePack: () => mockPack }));

const answer = (status: string, canAskAgain: boolean) => ({
  status,
  canAskAgain,
  granted: status === 'granted',
  expires: 'never',
});
const notAsked = answer('undetermined', true);
const allowed = answer('granted', true);
const refused = answer('denied', false);
/** Android asks a second time, so a first no leaves the question open. */
const refusedOnce = answer('denied', true);

const PACK = { name: 'Gym squad', category: 'gym', critters: { name: 'Mochi' } };
const PAUSE = { startsOn: '2026-11-02', endsOn: '2026-11-08' };
const CAMERA_NEEDED = 'Camera needed';

const appStates = new Set<(state: AppStateStatus) => void>();

let screen: ReactTestRenderer;
let settleAlert: (permission: unknown) => void;

async function open() {
  await act(async () => {
    screen = create(
      <QueryClientProvider client={new QueryClient()}>
        <FeedScreen />
      </QueryClientProvider>,
    );
  });
}

/** Opens the camera and takes a photo, which then waits for Send or Retake. */
async function takePhoto() {
  await act(async () => {
    screen = create(<FeedScreen />, {
      createNodeMock: (element) =>
        element.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: 'file:/photo.jpg', width: 1000 }) } : null,
    });
  });
  await act(async () => screen.root.findByType('CameraView' as never).props.onCameraReady());
  await press('Take photo');
}

async function answerAlert(permission: unknown) {
  await act(async () => settleAlert(permission));
}

async function comeBackToApp() {
  await act(async () => appStates.forEach((listener) => listener('active')));
}

const shown = () => JSON.stringify(screen.toJSON());
const buttons = () =>
  screen.root
    .findAll((node) => node.props.accessibilityRole === 'button' && typeof node.type === 'string')
    .map((node) => node.props.accessibilityLabel ?? JSON.stringify(node.props.children));
const hasCamera = () => screen.root.findAll((node) => node.type === 'CameraView').length === 1;
const press = (label: string) =>
  act(async () => {
    await screen.root.findAll((node) => (node.props.label === label || node.props.accessibilityLabel === label) && node.props.onPress)[0]?.props.onPress();
  });

beforeEach(() => {
  mockGet.mockReset();
  mockRequest.mockReset();
  mockBack.mockReset();
  mockDismissTo.mockReset();
  mockSend.mockReset();
  mockPause = null;
  appStates.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStates.add(listener);
    return { remove: () => appStates.delete(listener) };
  });
  mockPack = { data: PACK, isLoading: false, refetch: jest.fn() };
  settleAlert = () => {
    throw new Error('The system alert never came up');
  };
  mockRequest.mockImplementation(
    () =>
      new Promise((resolve) => {
        settleAlert = resolve;
      }),
  );
});

afterEach(async () => {
  await act(async () => screen.unmount());
});

describe('the first opening, when the system can still ask', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(notAsked);
  });

  it('goes straight to the system alert, with no screen of ours before it', async () => {
    await open();

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(shown()).not.toContain(CAMERA_NEEDED);
    expect(shown()).not.toContain('Allow camera');
    expect(buttons()).toEqual([]);
  });

  it('opens the camera on yes', async () => {
    await open();
    await answerAlert(allowed);

    expect(hasCamera()).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('leaves Open settings and Close on no', async () => {
    await open();
    await answerAlert(refused);

    expect(shown()).toContain(CAMERA_NEEDED);
    expect(shown()).toContain('Open settings');
    expect(shown()).toContain('Close');
    expect(shown()).not.toContain('Allow camera');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('asks once, even where the system could ask again', async () => {
    await open();
    await answerAlert(refusedOnce);

    expect(shown()).toContain('Open settings');
    expect(shown()).not.toContain('Allow camera');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('does not wait for an answer that left the question open', async () => {
    await open();
    await answerAlert(notAsked);

    expect(shown()).toContain('Open settings');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('waits while it is not known whether the pack is there', async () => {
    mockPack = { data: undefined, isLoading: true, refetch: jest.fn() };
    await open();
    expect(mockRequest).not.toHaveBeenCalled();

    mockPack = { data: PACK, isLoading: false, refetch: jest.fn() };
    await act(async () => screen.update(<FeedScreen />));
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('still asks offline, where the pack never loads and the camera works', async () => {
    mockPack = { data: undefined, isLoading: false, refetch: jest.fn() };
    await open();

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a pack that is gone', async () => {
    mockPack = { data: null, isLoading: false, refetch: jest.fn() };
    await open();

    expect(mockRequest).not.toHaveBeenCalled();
    expect(shown()).toContain("This pack isn't here");
  });
});

describe('an opening after the system has its answer', () => {
  it('goes straight to the camera when allowed', async () => {
    mockGet.mockResolvedValue(allowed);
    await open();

    expect(hasCamera()).toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('offers only Open settings and Close when refused for good', async () => {
    mockGet.mockResolvedValue(refused);
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await open();

    expect(mockRequest).not.toHaveBeenCalled();
    expect(shown()).toContain(CAMERA_NEEDED);
    expect(shown()).not.toContain('Allow camera');

    const press = (label: string) =>
      act(async () => screen.root.findAll((node) => node.props.label === label)[0]?.props.onPress());
    await press('Open settings');
    expect(settings).toHaveBeenCalledTimes(1);
    await press('Close');
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('coming back to the app', () => {
  it('opens the camera after a yes in the phone settings', async () => {
    mockGet.mockResolvedValue(refused);
    await open();
    expect(shown()).toContain(CAMERA_NEEDED);

    mockGet.mockResolvedValue(allowed);
    await comeBackToApp();

    expect(hasCamera()).toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('stays on Camera needed after a no, also where the system could ask again', async () => {
    mockGet.mockResolvedValue(notAsked);
    await open();
    await answerAlert(refusedOnce);

    mockGet.mockResolvedValue(refusedOnce);
    await comeBackToApp();

    expect(shown()).toContain(CAMERA_NEEDED);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('leaves the answer to the system alert while it is up', async () => {
    mockGet.mockResolvedValue(notAsked);
    await open();
    await comeBackToApp();
    expect(mockGet).toHaveBeenCalledTimes(1);

    await answerAlert(allowed);
    expect(hasCamera()).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('a pause reaching the camera', () => {
  beforeEach(() => {
    mockGet.mockResolvedValue(allowed);
    mockPack = { data: { ...PACK, critters: null }, isLoading: false, refetch: jest.fn() };
    mockSend.mockResolvedValue('sent');
  });

  const pauseArrives = async () => {
    mockPause = PAUSE;
    await act(async () => screen.update(<FeedScreen />));
  };

  it('leaves for the pack when there is no photo yet', async () => {
    await open();
    expect(hasCamera()).toBe(true);

    await pauseArrives();

    expect(mockDismissTo).toHaveBeenCalledWith('/pack/pack-1');
    expect(hasCamera()).toBe(false);
  });

  it('leaves a photo already taken on screen, and Send still sends it', async () => {
    await takePhoto();
    await pauseArrives();

    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(shown()).toContain('Send');

    await press('Send');

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('leaves for the pack on Retake, as that photo was the reason to stay', async () => {
    await takePhoto();
    await pauseArrives();

    await press('Retake');

    expect(mockDismissTo).toHaveBeenCalledWith('/pack/pack-1');
  });
});
