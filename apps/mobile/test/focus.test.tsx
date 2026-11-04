import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import FocusScreen from '@/app/(app)/pack/[id]/focus';
import { clearFocusSession, elapsedMs, focusedMinutes, remainingMs, useFocusSession, type FocusSession } from '@/features/focus/session';

// The phone's side of notifications. It keeps one request per identifier, as iOS and Android do,
// and a request whose time came moves to the delivered ones in Notification Center.
const mockScheduled = new Map<string, string>();
const mockDelivered = new Set<string>();
let mockRequests = 0;
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: async (request: { identifier?: string; content: { data: { url: string } } }) => {
    mockRequests += 1;
    const id = request.identifier ?? `request-${mockRequests}`;
    mockScheduled.set(id, request.content.data.url);
    return id;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    mockScheduled.delete(id);
  },
  dismissNotificationAsync: async (id: string) => {
    mockDelivered.delete(id);
  },
}));
jest.mock('@/lib/notifications', () => ({
  allowNotifications: async () => true,
  useNotificationPermission: () => ({ permission: 'granted', request: jest.fn() }),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'p1' }),
  useIsFocused: () => true,
  useNavigation: () => ({ isFocused: () => true, getState: () => ({ routes: [] }) }),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/features/critter/Critter', () => ({ Critter: () => null }));
jest.mock('@/features/packs/api', () => ({
  usePack: () => ({ data: { name: 'Study group', category: 'study', critters: null }, isPending: false, isError: false, refetch: jest.fn() }),
}));

const start = Date.UTC(2026, 8, 27, 10, 0);
const minute = 60_000;
const session = (patch: Partial<FocusSession> = {}): FocusSession => ({
  packId: 'p',
  minutes: 25,
  startedAt: start,
  pausedAt: null,
  pausedMs: 0,
  notificationId: null,
  ...patch,
});

describe('focus timer', () => {
  it('counts wall-clock time, so it keeps going in the background', () => {
    expect(elapsedMs(session(), start + 10 * minute)).toBe(10 * minute);
    expect(remainingMs(session(), start + 10 * minute)).toBe(15 * minute);
  });

  it('stops counting while paused, and leaves the paused time out after resuming', () => {
    const paused = session({ pausedAt: start + 5 * minute });
    expect(elapsedMs(paused, start + 20 * minute)).toBe(5 * minute);
    const resumed = session({ pausedMs: 15 * minute });
    expect(remainingMs(resumed, start + 30 * minute)).toBe(10 * minute);
  });

  it('never goes below zero', () => {
    expect(remainingMs(session(), start + 90 * minute)).toBe(0);
  });

  it('reports at least a minute, and no more than planned', () => {
    expect(focusedMinutes(session(), start + 10_000)).toBe(1);
    expect(focusedMinutes(session(), start + 90 * minute)).toBe(25);
    expect(focusedMinutes(session({ minutes: null }), start + 47 * minute)).toBe(47);
  });

  it('reports an open timer left running overnight as the longest session a feed can show', () => {
    // The feed takes 1 to 600 minutes; more made every send of that photo fail.
    expect(focusedMinutes(session({ minutes: null }), start + 11 * 60 * minute)).toBe(600);
  });

  it('has no end for an open timer', () => {
    expect(remainingMs(session({ minutes: null }), start + minute)).toBeNull();
  });
});

describe("a stored session that can't be read", () => {
  const STORAGE_KEY = 'gozali.focus';
  let focus: ReturnType<typeof useFocusSession>;
  let tree: ReactTestRenderer;

  function Timer() {
    focus = useFocusSession({ title: 'Done', body: 'Time is up' });
    return null;
  }

  async function open() {
    await act(async () => {
      tree = create(<Timer />);
    });
  }

  beforeEach(() => AsyncStorage.clear());

  afterEach(async () => {
    await act(async () => tree?.unmount());
    jest.restoreAllMocks();
  });

  it('opens the timer with no session, so a new one can start', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{"packId":"p","min');
    await open();

    expect(focus.loaded).toBe(true);
    expect(focus.session).toBeNull();

    await act(() => focus.start('p', null));
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!)).toMatchObject({ packId: 'p', minutes: null });
  });

  it('opens the timer when the phone fails to read its storage', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await open();

    expect(focus.loaded).toBe(true);
    expect(focus.session).toBeNull();
  });

  it('is cleared by the photo that ends a session', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, 'not json');

    await expect(clearFocusSession()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  describe('when the phone fails to remove it', () => {
    const full = new Error('database or disk is full');

    it("doesn't fail the photo that ends a session", async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session()));
      jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(full);

      await expect(clearFocusSession()).resolves.toBeUndefined();
    });

    it('still ends the session on the timer', async () => {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session({ startedAt: Date.now() - 10 * minute })));
      await open();
      jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(full);

      await act(() => focus.stop());

      expect(focus.session).toBeNull();
    });
  });
});

describe('the notice at the end of a session', () => {
  const STORAGE_KEY = 'gozali.focus';
  let screen: ReactTestRenderer;

  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  const press = (label: string) =>
    screen.root.findAll((node) => (node.props.label === label || node.props.accessibilityLabel === label) && node.props.onPress)[0]!.props.onPress();
  /** Its time came while the app was away. */
  const deliver = () => {
    for (const id of mockScheduled.keys()) mockDelivered.add(id);
    mockScheduled.clear();
  };

  async function open() {
    await act(async () => {
      screen = create(<FocusScreen />);
    });
    await settle();
  }

  beforeEach(async () => {
    await AsyncStorage.clear();
    mockScheduled.clear();
    mockDelivered.clear();
    // Stop asks first; this is the answer that stops.
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
  });

  afterEach(async () => {
    await act(async () => screen.unmount());
    jest.restoreAllMocks();
  });

  it('is one, however fast the taps on a length came, and Stop takes it away', async () => {
    await open();
    await act(async () => {
      press('25 minutes');
      press('25 minutes');
    });
    await settle();
    expect([...mockScheduled.values()]).toEqual(['/pack/p1/feed?focus=25']);

    await act(async () => press('Cancel'));
    await settle();
    expect(mockScheduled.size).toBe(0);
  });

  it('is one after two taps on Resume, and Pause takes it away', async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(session({ packId: 'p1', startedAt: Date.now() - 10 * minute, pausedAt: Date.now() - 2 * minute })),
    );
    await open();
    await act(async () => {
      press('Resume');
      press('Resume');
    });
    await settle();
    expect(mockScheduled.size).toBe(1);

    await act(async () => press('Pause'));
    await settle();
    expect(mockScheduled.size).toBe(0);
  });

  it('leaves Notification Center once delivered, when the session ends by Stop or by its photo', async () => {
    await open();
    await act(async () => press('25 minutes'));
    await settle();
    deliver();
    await act(async () => press('Cancel'));
    await settle();
    expect(mockDelivered.size).toBe(0);

    await act(async () => press('25 minutes'));
    await settle();
    deliver();
    await act(() => clearFocusSession('p1'));
    expect(mockDelivered.size).toBe(0);
  });
});
