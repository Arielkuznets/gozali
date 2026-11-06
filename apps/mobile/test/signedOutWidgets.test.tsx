import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { act, create } from 'react-test-renderer';

import { useSignedOutSync } from '@/features/profile/useProfile';
import { widgetTaskHandler } from '@/features/widgets/android/task';
import { resumeWidgets } from '@/features/widgets/sync';

// What a phone holds for the widgets when it starts with nobody signed in: the real signed-out
// sync, widget sync and Android task, with what is native replaced.
const mockAppGroup = new Map<string, string | undefined>();
const mockRedraw = jest.fn();
jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    static reloadWidget() {
      mockRedraw();
    }
    set(key: string, value: string | undefined) {
      mockAppGroup.set(key, value);
    }
  },
}));
const mockWidgetUpdates = jest.fn();
jest.mock('react-native-android-widget', () => ({
  FlexWidget: () => null,
  SvgWidget: () => null,
  TextWidget: () => null,
  requestWidgetUpdate: (update: unknown) => mockWidgetUpdates(update),
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: () => () => undefined }));
jest.mock('@/lib/push', () => ({ registerPushToken: async () => undefined, unregisterWhileSignedOut: async () => undefined }));

let mockAuth: { session: object | null; loading: boolean };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
  requireSupabase: () => ({}),
  storedSession: async () => null,
}));

const TOKEN_KEY = 'gozali.widget-token';
const OWNER_KEY = 'gozali.widget-token-owner';
const SNAPSHOT_KEY = 'gozali.widget-snapshot';

const snapshot = JSON.stringify({ timezone: 'UTC', fetchedAt: '2026-11-01T08:00:00Z', packs: [{ id: 'pack', name: "Alice's pack" }] });

const settle = () => new Promise((resolve) => setImmediate(resolve));

function SignedOutSync() {
  useSignedOutSync();
  return null;
}

async function startApp() {
  await act(async () => {
    create(<SignedOutSync />);
    await settle();
  });
}

/** What the Android task draws in the background, by the props of the widget it asks for. */
async function androidDraws() {
  let drawn: ReactElement<{ pack?: unknown }> | undefined;
  await widgetTaskHandler({
    widgetInfo: { widgetName: 'PackSmall', widgetId: 1 } as WidgetTaskHandlerProps['widgetInfo'],
    widgetAction: 'WIDGET_UPDATE',
    renderWidget: (widget) => {
      drawn = widget as ReactElement<{ pack?: unknown }>;
    },
  });
  return drawn?.props.pack;
}

const fetched = jest.fn();

beforeEach(async () => {
  await AsyncStorage.clear();
  resumeWidgets();
  mockAppGroup.clear();
  mockAppGroup.set('token', 'alice-token');
  mockAppGroup.set('snapshot', snapshot);
  mockRedraw.mockClear();
  mockWidgetUpdates.mockReset().mockResolvedValue(undefined);
  mockRpc.mockReset().mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
  mockAuth = { session: null, loading: false };
  fetched.mockReset();
  globalThis.fetch = fetched.mockImplementation(async () => new Response(snapshot)) as unknown as typeof fetch;
});

describe('a start with nobody signed in', () => {
  describe('and a widget token left behind', () => {
    beforeEach(() =>
      AsyncStorage.multiSet([
        [TOKEN_KEY, 'alice-token'],
        [SNAPSHOT_KEY, snapshot],
      ]),
    );

    it('forgets the token and the snapshot, and tells the iOS widgets', async () => {
      await startApp();

      expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
      expect(await AsyncStorage.getItem(SNAPSHOT_KEY)).toBeNull();
      expect(mockAppGroup.get('token')).toBeUndefined();
      expect(mockAppGroup.get('snapshot')).toBeUndefined();
      expect(mockRedraw).toHaveBeenCalledTimes(1);
    });

    it('leaves the Android task nothing to draw, and nothing to ask the server with', async () => {
      await startApp();

      expect(await androidDraws()).toBeUndefined();
      expect(fetched).not.toHaveBeenCalled();
    });

    it('tells the Android widgets', async () => {
      const os = jest.replaceProperty(Platform, 'OS', 'android');
      await startApp();
      os.restore();

      expect(mockWidgetUpdates).toHaveBeenCalled();
      expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    });
  });

  it('forgets a token whose owner was on record the same way', async () => {
    await AsyncStorage.multiSet([
      [TOKEN_KEY, 'alice-token'],
      [OWNER_KEY, 'alice'],
    ]);

    await startApp();

    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it('takes a snapshot with no token left off the widgets too: it would stay there for good', async () => {
    await AsyncStorage.setItem(SNAPSHOT_KEY, snapshot);

    await startApp();

    expect(await AsyncStorage.getItem(SNAPSHOT_KEY)).toBeNull();
    expect(await androidDraws()).toBeUndefined();
  });

  it('leaves the widgets alone with nothing there, so they are not woken on every start', async () => {
    await startApp();

    expect(mockRedraw).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('with someone signed in, or before that is known', () => {
  beforeEach(() =>
    AsyncStorage.multiSet([
      [TOKEN_KEY, 'alice-token'],
      [SNAPSHOT_KEY, snapshot],
    ]),
  );

  it.each([
    ['signed in', { session: { user: { id: 'alice' } }, loading: false }],
    ['still loading', { session: null, loading: true }],
  ])('keeps what the widgets hold: %s', async (_state, auth) => {
    mockAuth = auth;

    await startApp();

    expect(await AsyncStorage.getItem(TOKEN_KEY)).toBe('alice-token');
    expect(await AsyncStorage.getItem(SNAPSHOT_KEY)).toBe(snapshot);
    expect(mockRedraw).not.toHaveBeenCalled();
  });
});
