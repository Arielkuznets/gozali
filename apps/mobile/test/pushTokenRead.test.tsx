import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';

import { useSignedOutSync } from '@/features/profile/useProfile';
import { registerPushToken } from '@/lib/push';

// The token read is expo-notifications' own (getExpoPushTokenAsync over getDevicePushTokenAsync,
// with the repository's patch applied); only the native module under it is a stand-in.
const mockNativeRead = jest.fn();
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project' } } } },
}));
jest.mock('expo-application', () => ({ applicationId: 'app.gozali' }));
jest.mock('expo-notifications/build/PushTokenManager', () => ({
  __esModule: true,
  default: { getDevicePushTokenAsync: () => mockNativeRead() },
}));
jest.mock('expo-notifications/build/ServerRegistrationModule', () => ({
  __esModule: true,
  default: { getInstallationIdAsync: async () => 'INSTALL' },
}));
jest.mock('expo-notifications/build/DevicePushTokenAutoRegistration.fx', () => ({
  setAutoServerRegistrationEnabledAsync: async () => undefined,
}));
jest.mock('expo-notifications/build/warnOfExpoGoPushUsage', () => ({ warnOfExpoGoPushUsage: () => undefined }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  setNotificationChannelAsync: async () => undefined,
  AndroidImportance: { DEFAULT: 3 },
  getExpoPushTokenAsync: (options: unknown) =>
    jest.requireActual('expo-notifications/build/getExpoPushTokenAsync').getExpoPushTokenAsync(options),
}));

const mockRpc = jest.fn();
let mockStoredSession: object | null;
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  requireSupabase: () => ({
    rpc: (name: string, args: unknown) => mockRpc(name, args),
    auth: { getSession: async () => ({ data: { session: { user: { id: 'noa' } } } }) },
  }),
  storedSession: async () => mockStoredSession,
}));

let mockAuth: { session: object | null; loading: boolean };
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));

type Connection = { isConnected: boolean };
const mockNetwork = new Set<(state: Connection) => void>();
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: (listener: (state: Connection) => void) => {
    mockNetwork.add(listener);
    return () => mockNetwork.delete(listener);
  },
}));

const settle = () => new Promise((resolve) => setImmediate(resolve));
const registrations = () => mockRpc.mock.calls.filter(([name]) => name === 'register_push_token');

function SignedOutSync() {
  useSignedOutSync();
  return null;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockAuth = { session: null, loading: false };
  mockStoredSession = null;
  mockNativeRead.mockReset();
  mockRpc.mockReset().mockResolvedValue({ error: null });
  mockNetwork.clear();
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => undefined }));
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ data: { expoPushToken: 'ExponentPushToken[phone]' } }), {
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
});

describe('a read of the device token that the phone refuses', () => {
  it('leaves the next read free to ask again, so the register after a sign-in goes through', async () => {
    mockNativeRead.mockRejectedValueOnce(new Error('Fetching the token failed: SERVICE_NOT_AVAILABLE'));
    mockNativeRead.mockResolvedValue('fcm-token');

    const app = await act(async () => {
      const rendered = create(<SignedOutSync />);
      await settle();
      return rendered;
    });
    expect(mockNativeRead).toHaveBeenCalledTimes(1);

    mockStoredSession = { user: { id: 'noa' } };
    mockAuth = { session: mockStoredSession, loading: false };
    await act(async () => {
      app.update(<SignedOutSync />);
      await settle();
    });
    await registerPushToken();

    expect(mockNativeRead).toHaveBeenCalledTimes(2);
    expect(registrations()).toEqual([
      ['register_push_token', { device_token: 'ExponentPushToken[phone]', device: 'android' }],
    ]);
  });

  it('tries the read again when the connection comes back, for a phone with nobody signed in', async () => {
    mockNativeRead.mockRejectedValueOnce(new Error('Fetching the token failed: SERVICE_NOT_AVAILABLE'));
    mockNativeRead.mockResolvedValue('fcm-token');

    await act(async () => {
      create(<SignedOutSync />);
      await settle();
    });
    await act(async () => {
      mockNetwork.forEach((listener) => listener({ isConnected: true }));
      await settle();
    });

    expect(mockRpc.mock.calls).toEqual([['forget_push_token', { device_token: 'ExponentPushToken[phone]' }]]);
  });

  it('is shared by everyone already waiting on it, with one question to the phone', async () => {
    mockNativeRead.mockRejectedValueOnce(new Error('Fetching the token failed: SERVICE_NOT_AVAILABLE'));
    mockNativeRead.mockResolvedValue('fcm-token');
    const { getDevicePushTokenAsync } = jest.requireActual('expo-notifications/build/getDevicePushTokenAsync');

    const reads = await Promise.allSettled([getDevicePushTokenAsync(), getDevicePushTokenAsync()]);

    expect(reads.map((read) => read.status)).toEqual(['rejected', 'rejected']);
    expect(mockNativeRead).toHaveBeenCalledTimes(1);
  });
});
