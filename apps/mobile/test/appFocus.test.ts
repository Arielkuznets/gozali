import { QueryClient, QueryObserver, focusManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { refetchWhenAppReturns } from '@/lib/appFocus';

const listeners = new Set<(state: AppStateStatus) => void>();

/** The states a phone reports, in order, and the time the app needs to act on them. */
async function phoneReports(...states: AppStateStatus[]) {
  for (const state of states) {
    AppState.currentState = state;
    listeners.forEach((listener) => listener(state));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const LEAVING = ['inactive', 'background'] as const;
// iOS 26 and 27 become active for a moment when the side button locks the phone.
const LOCKED = ['inactive', 'active', 'inactive', 'background'] as const;

let reads = 0;
let client: QueryClient;
let stop: () => void;

/** A start of the app with one read on screen. Nothing has told the focus manager anything yet. */
async function start(state: AppStateStatus) {
  AppState.currentState = state;
  focusManager.setFocused(undefined);
  refetchWhenAppReturns();
  reads = 0;
  client = new QueryClient();
  client.mount();
  stop = new QueryObserver(client, {
    queryKey: ['on screen'],
    queryFn: async () => {
      reads += 1;
      return reads;
    },
  }).subscribe(() => undefined);
  await phoneReports();
  expect(reads).toBe(1);
}

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: AppStateStatus) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  }) as never);
});

afterEach(() => {
  stop();
  client.unmount();
  client.clear();
  listeners.clear();
  jest.restoreAllMocks();
});

describe('what counts as coming back to the app', () => {
  it('not the first active of a start, which iOS reaches from inactive', async () => {
    await start('inactive');
    await phoneReports('active');
    expect(reads).toBe(1);
  });

  it('not Control Center, Notification Center or a system sheet, even as the first change after a start', async () => {
    await start('active');
    await phoneReports('inactive', 'active');
    expect(reads).toBe(1);
    await phoneReports('inactive', 'active');
    expect(reads).toBe(1);
  });

  it('not the side button locking the phone', async () => {
    await start('active');
    await phoneReports(...LOCKED);
    expect(reads).toBe(1);
  });

  it('coming back from the background', async () => {
    await start('active');
    await phoneReports(...LEAVING, 'active');
    expect(reads).toBe(2);
    await phoneReports(...LEAVING, 'active');
    expect(reads).toBe(3);
  });

  it('unlocking the phone', async () => {
    await start('active');
    await phoneReports(...LOCKED, 'active');
    expect(reads).toBe(2);
  });

  it('on Android, which has no inactive', async () => {
    await start('active');
    await phoneReports('background', 'active');
    expect(reads).toBe(2);
  });

  it('opening an app that started out of sight, as when it was left during the start', async () => {
    await start('background');
    await phoneReports('active');
    expect(reads).toBe(2);
  });
});
