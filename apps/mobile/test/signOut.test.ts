import { signOut } from '@/features/auth/signIn';

// What the phone keeps for the account is forgotten first; here that is all a no-op.
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined }));
jest.mock('@/features/focus/session', () => ({ clearFocusSession: async () => undefined }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: async () => undefined }));
const mockClearQueue = jest.fn(async () => undefined);
jest.mock('@/features/feeds/queue', () => ({ clearQueue: () => mockClearQueue() }));

const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ auth: { signOut: () => mockSignOut(), getSession: () => mockGetSession() } }),
}));

const offline = new TypeError('Network request failed');

beforeEach(() => {
  mockClearQueue.mockClear();
  mockSignOut.mockReset();
  mockGetSession.mockReset();
});

describe('signing out', () => {
  it('is done when the server answers, and forgets the feeds still waiting', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await expect(signOut()).resolves.toBeUndefined();
    expect(mockClearQueue).toHaveBeenCalledTimes(1);
  });

  it('is done offline once the session is gone from the phone', async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(signOut()).resolves.toBeUndefined();
  });

  it("didn't work when the session is still on the phone, which keeps its waiting feeds", async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'still here' } }, error: null });
    await expect(signOut()).rejects.toBe(offline);
    expect(mockClearQueue).not.toHaveBeenCalled();
  });

  it("didn't work when an expired session couldn't be refreshed and so stays stored", async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: offline });
    await expect(signOut()).rejects.toBe(offline);
  });
});
