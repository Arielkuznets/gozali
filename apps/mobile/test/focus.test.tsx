import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { clearFocusSession, elapsedMs, focusedMinutes, remainingMs, useFocusSession, type FocusSession } from '@/features/focus/session';

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
});
