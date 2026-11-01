import { signOut } from '@/features/auth/signIn';

// Taking back what the phone keeps for the account is a no-op here; the tests look at when it happens.
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined, resumeWidgets: () => undefined }));
const mockClearQueue = jest.fn(async () => undefined);
const mockClearFocusSession = jest.fn(async () => undefined);
const mockClearNotifications = jest.fn(async () => undefined);
jest.mock('@/features/focus/session', () => ({ clearFocusSession: () => mockClearFocusSession() }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: () => mockClearNotifications() }));
jest.mock('@/features/feeds/queue', () => ({ clearQueue: () => mockClearQueue() }));

const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ auth: { signOut: () => mockSignOut(), getSession: () => mockGetSession() } }),
}));

const offline = new TypeError('Network request failed');

const keptUntilSignedOut = [mockClearQueue, mockClearFocusSession, mockClearNotifications];

beforeEach(() => {
  for (const clear of keptUntilSignedOut) clear.mockClear();
  mockSignOut.mockReset();
  mockGetSession.mockReset();
});

describe('signing out', () => {
  it('is done when the server answers, and then forgets the feeds, the focus timer and the notifications', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await expect(signOut()).resolves.toBeUndefined();
    for (const clear of keptUntilSignedOut) {
      expect(clear).toHaveBeenCalledTimes(1);
      expect(clear.mock.invocationCallOrder[0]).toBeGreaterThan(mockSignOut.mock.invocationCallOrder[0]);
    }
  });

  it('is done offline once the session is gone from the phone', async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(signOut()).resolves.toBeUndefined();
    for (const clear of keptUntilSignedOut) expect(clear).toHaveBeenCalledTimes(1);
  });

  it("didn't work when the session is still on the phone, which keeps what it had going", async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'still here' } }, error: null });
    await expect(signOut()).rejects.toBe(offline);
    for (const clear of keptUntilSignedOut) expect(clear).not.toHaveBeenCalled();
  });

  it("didn't work when an expired session couldn't be refreshed and so stays stored", async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: offline });
    await expect(signOut()).rejects.toBe(offline);
    for (const clear of keptUntilSignedOut) expect(clear).not.toHaveBeenCalled();
  });
});
