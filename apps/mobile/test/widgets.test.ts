import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { loadSnapshot, savedWidgetToken } from '@/features/widgets/data';
import { clearWidgets, clearWidgetsLeftBehind, refreshWidgets, resumeWidgets, useWidgetSync } from '@/features/widgets/sync';
import { noteServerDate, serverNow } from '@/lib/serverClock';

// What the widgets on the home screen read.
const mockAppGroup = new Map<string, string | undefined>();
jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    static reloadWidget() {}
    set(key: string, value: string | undefined) {
      mockAppGroup.set(key, value);
    }
  },
}));
jest.mock('@/features/widgets/android/task', () => ({ updateAndroidWidgets: jest.fn() }));

// The server hands out new tokens and knows only those: it forgets a token nobody used for 90 days.
const mockRpc = jest.fn();
let mockSignedIn: string | null;
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  storedSession: async () => (mockSignedIn ? { user: { id: mockSignedIn } } : null),
}));

/** The token as an earlier refresh for that account left it. */
const saveToken = (token: string, owner: string) =>
  AsyncStorage.multiSet([
    ['gozali.widget-token', token],
    ['gozali.widget-token-owner', owner],
  ]);

const snapshot = { timezone: 'Asia/Jerusalem', fetchedAt: '2026-10-29T08:00:00Z', packs: [] };
type Answer = { status: number; ok: boolean; headers: Headers; json: () => Promise<unknown>; text: () => Promise<string> };
const answer = (status: number, body: string, headers?: Record<string, string>): Answer => ({
  status,
  ok: status === 200,
  headers: new Headers(headers),
  json: async () => JSON.parse(body),
  text: async () => body,
});
const mockFetch = jest.fn(async (_url: string, init: { headers: Record<string, string> }): Promise<Answer> =>
  init.headers['x-widget-token'] === 'new-token' ? answer(200, JSON.stringify(snapshot)) : answer(401, 'unknown token'),
);

beforeEach(async () => {
  resumeWidgets();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockSignedIn = 'noa';
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockRpc.mockResolvedValue({ data: 'new-token', error: null });
});

describe('the saved snapshot', () => {
  it("counts as none when it can't be read", async () => {
    await AsyncStorage.setItem('gozali.widget-snapshot', '{"packs":[');

    await expect(loadSnapshot()).resolves.toBeNull();
  });
});

describe('refreshing the widgets', () => {
  it('gets a new token when the server forgot the old one', async () => {
    // Back after three months without the app or a widget.
    await saveToken('old-token', 'noa');

    await refreshWidgets();
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toMatchObject(snapshot);
  });

  it('keeps the token when the server is out of reach', async () => {
    await saveToken('old-token', 'noa');
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await refreshWidgets();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('old-token');
  });

  it("doesn't leave a token for the account that signed out while it ran", async () => {
    let made: (answer: { data: string; error: null }) => void = () => undefined;
    mockRpc.mockImplementation(async (name: string) =>
      name === 'create_widget_token' ? new Promise((resolve) => (made = resolve)) : { data: null, error: null },
    );

    const refresh = refreshWidgets();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await clearWidgets();
    made({ data: 'new-token', error: null });
    await refresh;

    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
    expect(await AsyncStorage.getItem('gozali.widget-snapshot')).toBeNull();
  });

  it('makes no token for an account that has started signing out', async () => {
    await clearWidgets();
    // The sign-out is still on its way: the session is valid, and the debounced refresh fires.
    await refreshWidgets();

    expect(mockRpc).not.toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
  });

  it('goes blank once however many times an account leaves', async () => {
    await saveToken('new-token', 'noa');
    await clearWidgets();
    mockRpc.mockClear();
    jest.mocked(AsyncStorage.multiRemove).mockClear();

    await clearWidgets();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  });
});

describe('a revoke the connection holds up', () => {
  const left = { ...snapshot, packs: [{ id: 'left', name: 'Left behind' }] };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  let endRevoke: () => void;

  beforeEach(async () => {
    await saveToken('left-behind', 'dan');
    await AsyncStorage.setItem('gozali.widget-snapshot', JSON.stringify(left));
    mockAppGroup.set('snapshot', JSON.stringify(left));
    mockAppGroup.set('token', 'left-behind');
    let held = false;
    mockRpc.mockImplementation((name: string) => {
      if (name !== 'revoke_widget_token' || held) return Promise.resolve({ data: 'new-token', error: null });
      held = true;
      return new Promise((resolve) => {
        endRevoke = () => resolve({ data: null, error: { code: '42501', message: 'permission denied' } });
      });
    });
  });

  it("leaves the next account's token and widgets alone when it ends", async () => {
    mockSignedIn = null;
    const clearing = clearWidgetsLeftBehind();
    await settle();

    mockSignedIn = 'noa';
    resumeWidgets();
    await refreshWidgets();
    endRevoke();
    await clearing;

    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(await AsyncStorage.getItem('gozali.widget-token-owner')).toBe('noa');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toMatchObject(snapshot);
    expect(mockAppGroup.get('token')).toBe('new-token');
    expect(JSON.parse(mockAppGroup.get('snapshot')!)).toMatchObject(snapshot);
  });

  it('holds a sign-out back, with nothing of the account left on the phone meanwhile', async () => {
    let cleared = false;
    const clearing = clearWidgets().then(() => {
      cleared = true;
    });
    await settle();

    expect(cleared).toBe(false);
    expect(await AsyncStorage.multiGet(['gozali.widget-token', 'gozali.widget-token-owner', 'gozali.widget-snapshot'])).toEqual([
      ['gozali.widget-token', null],
      ['gozali.widget-token-owner', null],
      ['gozali.widget-snapshot', null],
    ]);
    expect(mockAppGroup.get('token')).toBeUndefined();
    expect(mockAppGroup.get('snapshot')).toBeUndefined();

    endRevoke();
    await clearing;
    expect(cleared).toBe(true);
  });
});

describe("a refresh and the server's clock", () => {
  afterEach(() => noteServerDate(new Date().toUTCString(), Date.now(), Date.now()));

  it('shows that the clock moved, even with nothing on screen old enough to be read again', async () => {
    const threeHours = 3 * 60 * 60_000;
    await saveToken('new-token', 'noa');
    mockFetch.mockResolvedValueOnce(answer(200, JSON.stringify(snapshot), { date: new Date(Date.now() + threeHours).toUTCString() }));

    await refreshWidgets();

    expect(Math.abs(serverNow().getTime() - Date.now() - threeHours)).toBeLessThan(2000);
  });
});

describe('whose token it is', () => {
  const left = { ...snapshot, packs: [{ id: 'left', name: 'Left behind' }] };

  beforeEach(async () => {
    await AsyncStorage.setItem('gozali.widget-snapshot', JSON.stringify(left));
    mockAppGroup.set('snapshot', JSON.stringify(left));
  });

  it('uses the token of the signed-in account', async () => {
    await saveToken('new-token', 'noa');

    await refreshWidgets();

    expect(mockRpc).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toMatchObject(snapshot);
  });

  it("replaces another account's token and shows the new account's state", async () => {
    await saveToken('dans-token', 'dan');

    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(mockFetch.mock.calls.map(([, init]) => init.headers['x-widget-token'])).toEqual(['new-token']);
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(await AsyncStorage.getItem('gozali.widget-token-owner')).toBe('noa');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toMatchObject(snapshot);
  });

  it('replaces a token from before owners were kept', async () => {
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');

    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(await AsyncStorage.getItem('gozali.widget-token-owner')).toBe('noa');
  });

  it('makes the new token before it takes back one from before owners were kept', async () => {
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');

    await refreshWidgets();

    expect(mockRpc.mock.calls).toEqual([['create_widget_token'], ['revoke_widget_token', { token: 'old-token' }]]);
    expect(mockFetch.mock.calls.map(([, init]) => init.headers['x-widget-token'])).toEqual(['new-token']);
  });

  it('keeps a token from before owners were kept, and what the widgets show, when no new one can be had', async () => {
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Network request failed' } });
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await refreshWidgets();

    expect(mockRpc.mock.calls).toEqual([['create_widget_token']]);
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('old-token');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toEqual(left);
    expect(mockAppGroup.get('snapshot')).toBe(JSON.stringify(left));
  });

  it('replaces that token on the next refresh with a connection', async () => {
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Network request failed' } });
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await refreshWidgets();

    await refreshWidgets();

    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(await AsyncStorage.getItem('gozali.widget-token-owner')).toBe('noa');
    expect(mockAppGroup.get('token')).toBe('new-token');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toMatchObject(snapshot);
  });

  it('forgets a token from before owners were kept with nobody signed in', async () => {
    mockSignedIn = null;
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');

    await refreshWidgets();

    expect(mockRpc).not.toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
    expect(await AsyncStorage.getItem('gozali.widget-snapshot')).toBeNull();
  });

  it("takes another account's packs off the widgets when no new token can be had", async () => {
    await saveToken('dans-token', 'dan');
    mockRpc.mockResolvedValue({ data: null, error: { message: 'TypeError: Network request failed' } });

    await refreshWidgets();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
    expect(await AsyncStorage.getItem('gozali.widget-snapshot')).toBeNull();
    expect(mockAppGroup.get('snapshot')).toBeUndefined();
    expect(mockAppGroup.get('token')).toBeUndefined();
  });

  it('makes no token with nobody signed in', async () => {
    mockSignedIn = null;
    await saveToken('dans-token', 'dan');

    await refreshWidgets();

    expect(mockRpc).not.toHaveBeenCalledWith('create_widget_token');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
  });

  it('keeps what the widgets show when a fetch fails for the same account', async () => {
    await saveToken('old-token', 'noa');
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await refreshWidgets();

    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toEqual(left);
    expect(mockAppGroup.get('snapshot')).toBe(JSON.stringify(left));
  });

  it('asks nothing of the server to read the token in the background', async () => {
    await saveToken('dans-token', 'dan');

    expect(await savedWidgetToken()).toBe('dans-token');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('keeping the widgets in step with the app', () => {
  const write = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  let app: ReactTestRenderer;
  let client: QueryClient;

  function Synced() {
    useWidgetSync();
    return null;
  }

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    client = new QueryClient();
    await saveToken('new-token', 'noa');
  });

  afterEach(() => {
    act(() => app.unmount());
    client.clear();
    jest.mocked(AsyncStorage.setItem).mockImplementation(write);
    jest.useRealTimers();
  });

  /** A refresh, with what it set off done: an unhandled rejection fails the test while it runs. */
  async function refreshNow() {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('lets a refresh fail on a phone too full to keep the snapshot, and tries again at the next', async () => {
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      if (key === 'gozali.widget-snapshot') throw new Error('Failed to write value.');
      return write(key, value);
    });
    await act(async () => {
      app = create(createElement(QueryClientProvider, { client }, createElement(Synced)));
    });
    await refreshNow();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    jest.mocked(AsyncStorage.setItem).mockImplementation(write);
    await act(async () => {
      await client.fetchQuery({ queryKey: ['packs'], queryFn: async () => [] });
    });
    await refreshNow();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toMatchObject(snapshot);
  });
});
