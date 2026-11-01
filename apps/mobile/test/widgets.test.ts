import AsyncStorage from '@react-native-async-storage/async-storage';

import { widgetToken } from '@/features/widgets/data';
import { clearWidgets, refreshWidgets, resumeWidgets } from '@/features/widgets/sync';
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

describe('refreshing the widgets', () => {
  it('gets a new token when the server forgot the old one', async () => {
    // Back after three months without the app or a widget.
    await saveToken('old-token', 'noa');

    await refreshWidgets();
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toEqual(snapshot);
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
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toEqual(snapshot);
  });

  it("replaces another account's token and shows the new account's state", async () => {
    await saveToken('dans-token', 'dan');

    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(mockFetch.mock.calls.map(([, init]) => init.headers['x-widget-token'])).toEqual(['new-token']);
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(await AsyncStorage.getItem('gozali.widget-token-owner')).toBe('noa');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toEqual(snapshot);
  });

  it('replaces a token from before owners were kept', async () => {
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');

    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(await AsyncStorage.getItem('gozali.widget-token-owner')).toBe('noa');
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

    expect(await widgetToken(false)).toBe('dans-token');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
