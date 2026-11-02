import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ProfileSetupScreen from '@/app/profile-setup';
import { Button } from '@/components/Button';
import { isProfileComplete, useAccountSync, useProfile, type Profile } from '@/features/profile/useProfile';

type Permission = { granted: boolean; canAskAgain: boolean };

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'project' } } } },
}));
let mockPermission: Permission;
/** What the person answers, as the phone then reports the permission. */
let mockAnswer: Permission;
const mockPrompt = jest.fn();
jest.mock('expo-notifications', () => ({
  setNotificationHandler: () => undefined,
  getPermissionsAsync: async () => mockPermission,
  requestPermissionsAsync: async () => {
    mockPrompt();
    mockPermission = mockAnswer;
    return mockPermission;
  },
  getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[phone]' }),
}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } }, loading: false }) }));
jest.mock('@/features/auth/signIn', () => ({ forgetOtherAccounts: async () => undefined, signOut: async () => undefined }));
jest.mock('@/features/profile/AvatarButton', () => ({ AvatarButton: () => null }));
jest.mock('@/lib/reportError', () => ({ sendPendingCrash: async () => undefined }));
let mockProfile: Partial<Profile>;
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { ...mockProfile }, error: null }) }) }),
      update: (change: Partial<Profile>) => ({
        eq: async () => {
          Object.assign(mockProfile, change);
          return { error: null };
        },
      }),
    }),
    rpc: async (name: string) => {
      mockRpc(name);
      return { error: null };
    },
    auth: { getSession: async () => ({ data: { session: { user: { id: 'noa' } } } }) },
  }),
}));

const NEVER_ASKED = { granted: false, canAskAgain: true };
const FINISHED = { display_name: 'Noa', terms_accepted_at: '2026-11-01T00:00:00Z' };

function AccountSync() {
  useAccountSync();
  return null;
}

/** The guards of the root layout: the account sync opens with the app, past the profile setup. */
function Root() {
  const { data: profile } = useProfile();
  if (!profile) return null;
  return isProfileComplete(profile) ? <AccountSync /> : <ProfileSetupScreen />;
}

let client: QueryClient;
let app: ReactTestRenderer;

/** Long enough for the profile to load and for what it starts to finish. */
async function settle() {
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function startApp() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <Root />
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function closeApp() {
  await act(async () => app.unmount());
  client.clear();
}

async function restartApp() {
  await closeApp();
  await startApp();
}

async function finishProfileSetup() {
  await act(async () => app.root.findByType(TextInput).props.onChangeText('Noa'));
  await act(async () => app.root.findAllByProps({ accessibilityRole: 'checkbox' })[0]?.props.onPress());
  await act(async () => app.root.findByType(Button).props.onPress());
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockProfile = { id: 'noa', timezone: 'UTC', ...FINISHED };
  mockPermission = NEVER_ASKED;
  mockAnswer = { granted: true, canAskAgain: true };
  mockPrompt.mockClear();
  mockRpc.mockClear();
});

afterEach(closeApp);

describe('an account that skips the profile setup, on a phone that never asked', () => {
  it('is asked once the app opens', async () => {
    await startApp();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('gets its token to the server after a yes', async () => {
    await startApp();
    expect(mockRpc).toHaveBeenCalledWith('register_push_token');
  });

  it('is not asked again after a no that ends the asking', async () => {
    mockAnswer = { granted: false, canAskAgain: false };
    await startApp();
    await restartApp();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('is not asked again after a no that leaves the phone able to ask, as on Android', async () => {
    mockAnswer = NEVER_ASKED;
    await startApp();
    await restartApp();
    await restartApp();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });
});

describe('on a phone that has an answer already', () => {
  it('asks nothing while notifications are allowed', async () => {
    mockPermission = { granted: true, canAskAgain: true };
    await startApp();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('leaves it to the person who turns them off later in the phone settings', async () => {
    mockPermission = { granted: true, canAskAgain: true };
    await startApp();
    mockPermission = NEVER_ASKED;
    await restartApp();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('asks nothing when the phone blocks asking', async () => {
    mockPermission = { granted: false, canAskAgain: false };
    await startApp();
    expect(mockPrompt).not.toHaveBeenCalled();
  });
});

describe('a new account', () => {
  it('is asked once, when the profile setup is done', async () => {
    mockProfile = { id: 'noa', timezone: 'UTC', display_name: null, terms_accepted_at: null };
    await startApp();
    expect(mockPrompt).not.toHaveBeenCalled();

    await finishProfileSetup();
    expect(mockProfile.display_name).toBe('Noa');
    expect(mockPrompt).toHaveBeenCalledTimes(1);

    await restartApp();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it('is not asked a second time at the next start after a no that leaves the phone able to ask', async () => {
    mockAnswer = NEVER_ASKED;
    mockProfile = { id: 'noa', timezone: 'UTC', display_name: null, terms_accepted_at: null };
    await startApp();
    await finishProfileSetup();
    await restartApp();
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  describe('on a phone that already asked another account', () => {
    beforeEach(async () => {
      mockAnswer = NEVER_ASKED;
      await startApp();
      expect(mockPrompt).toHaveBeenCalledTimes(1);

      mockAnswer = { granted: true, canAskAgain: true };
      mockProfile = { id: 'noa', timezone: 'UTC', display_name: null, terms_accepted_at: null };
      mockRpc.mockClear();
      await restartApp();
    });

    it('gets the prompt the setup promised, and its token to the server after a yes', async () => {
      await finishProfileSetup();

      expect(mockPrompt).toHaveBeenCalledTimes(2);
      expect(mockRpc).toHaveBeenCalledWith('register_push_token');
    });

    it('is not asked again at the next start after a no that leaves the phone able to ask', async () => {
      mockAnswer = NEVER_ASKED;
      await finishProfileSetup();
      await restartApp();

      expect(mockPrompt).toHaveBeenCalledTimes(2);
    });

    it('finishes the setup when the phone fails to forget the first prompt', async () => {
      jest.mocked(AsyncStorage.removeItem).mockRejectedValueOnce(new Error('database or disk is full'));
      await finishProfileSetup();

      expect(mockProfile.display_name).toBe('Noa');
      expect(app.root.findAllByType(TextInput)).toEqual([]);
    });
  });
});
