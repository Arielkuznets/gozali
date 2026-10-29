import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearWidgets, refreshWidgets, resumeWidgets } from '@/features/widgets/sync';

jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    static reloadWidget() {}
    set() {}
  },
}));
jest.mock('@/features/widgets/android/task', () => ({ updateAndroidWidgets: jest.fn() }));

// The server hands out new tokens and knows only those: it forgets a token nobody used for 90 days.
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

const snapshot = { timezone: 'Asia/Jerusalem', fetchedAt: '2026-10-29T08:00:00Z', packs: [] };
type Answer = { status: number; ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> };
const answer = (status: number, body: string): Answer => ({
  status,
  ok: status === 200,
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
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockRpc.mockResolvedValue({ data: 'new-token', error: null });
});

describe('refreshing the widgets', () => {
  it('gets a new token when the server forgot the old one', async () => {
    // Back after three months without the app or a widget.
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');

    await refreshWidgets();
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBeNull();
    await refreshWidgets();

    expect(mockRpc).toHaveBeenCalledWith('create_widget_token');
    expect(await AsyncStorage.getItem('gozali.widget-token')).toBe('new-token');
    expect(JSON.parse((await AsyncStorage.getItem('gozali.widget-snapshot'))!)).toEqual(snapshot);
  });

  it('keeps the token when the server is out of reach', async () => {
    await AsyncStorage.setItem('gozali.widget-token', 'old-token');
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
});
