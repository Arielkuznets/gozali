import { deleteAccount } from '@/features/auth/signIn';

// What the phone keeps for the account is forgotten afterwards; here that is all a no-op.
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: async () => undefined }));
const mockClearQueue = jest.fn(async () => undefined);
const mockClearFocusSession = jest.fn(async () => undefined);
jest.mock('@/features/focus/session', () => ({ clearFocusSession: () => mockClearFocusSession() }));
jest.mock('@/features/feeds/queue', () => ({ clearQueue: () => mockClearQueue() }));

const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({ signInAsync: (...args: unknown[]) => mockSignInAsync(...args) }));
const mockInvoke = jest.fn();
const mockGetUser = jest.fn();
const mockSignOut = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    auth: {
      getUser: () => mockGetUser(),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  }),
}));

const cancelled = Object.assign(new Error('The user canceled the authorization attempt'), { code: 'ERR_REQUEST_CANCELED' });
const rejectAfter = (ms: number, error: unknown) => () => new Promise((_resolve, reject) => setTimeout(() => reject(error), ms));
const appleUser = { user: { app_metadata: { providers: ['apple'] } } };

beforeEach(() => {
  mockSignInAsync.mockReset();
  mockInvoke.mockReset().mockResolvedValue({ error: null });
  mockGetUser.mockReset().mockResolvedValue({ data: appleUser, error: null });
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  mockClearQueue.mockClear();
  mockClearFocusSession.mockClear();
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

describe('a deletion that gets no good answer from the server', () => {
  const noAnswer = new Error('Failed to send a request to the Edge Function');
  const forgotten = [mockClearQueue, mockClearFocusSession, mockSignOut];

  beforeEach(() => {
    mockInvoke.mockResolvedValue({ error: noAnswer });
  });

  it('is done when the server no longer has the account, and forgets it on this phone', async () => {
    const gone = Object.assign(new Error('User from sub claim in JWT does not exist'), { code: 'user_not_found' });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: gone });

    await expect(deleteAccount({ revokeApple: false })).resolves.toBeUndefined();

    for (const forget of forgotten) expect(forget).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('is done on a retry too, without asking Apple again for an account that is gone', async () => {
    const gone = Object.assign(new Error('User from sub claim in JWT does not exist'), { code: 'user_not_found' });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: gone });

    await expect(deleteAccount({ revokeApple: true })).resolves.toBeUndefined();

    expect(mockSignInAsync).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith('delete-account', expect.objectContaining({ body: {} }));
  });

  it('failed while the account is still there, and the phone keeps everything', async () => {
    await expect(deleteAccount({ revokeApple: false })).rejects.toBe(noAnswer);
    for (const forget of forgotten) expect(forget).not.toHaveBeenCalled();
  });

  it("failed when the server can't be asked either", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new TypeError('Network request failed') });

    await expect(deleteAccount({ revokeApple: false })).rejects.toBe(noAnswer);
    for (const forget of forgotten) expect(forget).not.toHaveBeenCalled();
  });

  it('failed when the session is gone but the account may not be', async () => {
    const noSession = Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' });
    mockGetUser.mockResolvedValue({ data: { user: null }, error: noSession });

    await expect(deleteAccount({ revokeApple: false })).rejects.toBe(noAnswer);
    for (const forget of forgotten) expect(forget).not.toHaveBeenCalled();
  });
});
