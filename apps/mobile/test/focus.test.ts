import { elapsedMs, focusedMinutes, remainingMs, type FocusSession } from '@/features/focus/session';

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

  it('has no end for an open timer', () => {
    expect(remainingMs(session({ minutes: null }), start + minute)).toBeNull();
  });
});
