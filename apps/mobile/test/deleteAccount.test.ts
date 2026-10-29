import { deleteAccount } from '@/features/auth/signIn';

// What the phone keeps for the account is forgotten afterwards; here that is all a no-op.
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: async () => undefined }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: async () => undefined }));
jest.mock('@/features/feeds/queue', () => ({ clearQueue: async () => undefined }));

const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({ signInAsync: (...args: unknown[]) => mockSignInAsync(...args) }));
const mockInvoke = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: { app_metadata: { providers: ['apple'] } } } }),
      signOut: async () => ({ error: null }),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  }),
}));

const cancelled = Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' });
const rejectAfter = (ms: number, error: unknown) => () => new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));

beforeEach(() => {
  mockSignInAsync.mockReset();
  mockInvoke.mockReset().mockResolvedValue({ error: null });
});

describe('deleting an account that signed in with Apple, with revocation on', () => {
  it("sends Apple's fresh code along", async () => {
    mockSignInAsync.mockResolvedValue({ authorizationCode: 'fresh-code' });
    await deleteAccount({ revokeApple: true });
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', expect.objectContaining({ body: { appleAuthorizationCode: 'fresh-code' } }));
  });

  it("stops when the person closes Apple's sheet", async () => {
    mockSignInAsync.mockImplementation(rejectAfter(1200, cancelled));
    await expect(deleteAccount({ revokeApple: true })).rejects.toBe(cancelled);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("goes on without the code when Apple's sheet never opened", async () => {
    mockSignInAsync.mockImplementation(rejectAfter(50, cancelled));
    await deleteAccount({ revokeApple: true });
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', expect.objectContaining({ body: {} }));
  });
});
