import AsyncStorage from '@react-native-async-storage/async-storage';

import { signOut } from '@/features/auth/signIn';
import { suggestName, suggestedName } from '@/features/profile/suggestedName';

// Taking back what the phone keeps for the account is a no-op here; the tests look at when it happens.
jest.mock('@/lib/push', () => ({ unregisterPushToken: async () => undefined }));
jest.mock('@/features/widgets/sync', () => ({ clearWidgets: async () => undefined, resumeWidgets: () => undefined }));
const mockForgetFeedsOf = jest.fn(async (_userId: string) => undefined);
const mockClearFocusSession = jest.fn(async () => undefined);
const mockClearNotifications = jest.fn(async () => undefined);
jest.mock('@/features/focus/session', () => ({ clearFocusSession: () => mockClearFocusSession() }));
jest.mock('@/lib/notifications', () => ({ clearNotifications: () => mockClearNotifications() }));
jest.mock('@/features/feeds/queue', () => ({ forgetFeedsOf: (userId: string) => mockForgetFeedsOf(userId) }));

const mockSignOut = jest.fn();
const mockGetSession = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ auth: { signOut: () => mockSignOut(), getSession: () => mockGetSession() } }),
  storedSession: async () => ({ user: { id: 'noa' } }),
}));

const offline = new TypeError('Network request failed');

const keptUntilSignedOut = [mockForgetFeedsOf, mockClearFocusSession, mockClearNotifications];

beforeEach(async () => {
  await AsyncStorage.clear();
  for (const clear of keptUntilSignedOut) clear.mockClear();
  mockSignOut.mockReset();
  mockGetSession.mockReset();
  suggestName('Noa Levi');
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

  it('forgets the feeds of the account that left, not of anyone else', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockForgetFeedsOf).toHaveBeenCalledWith('noa');
  });

  it('leaves the focus timer of the account on record to it', async () => {
    await AsyncStorage.setItem('gozali.last-account', 'dan');
    mockSignOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockClearFocusSession).not.toHaveBeenCalled();
    expect(mockClearNotifications).toHaveBeenCalledTimes(1);
  });

  it('takes the timer of an account on record as its own to forget', async () => {
    await AsyncStorage.setItem('gozali.last-account', 'noa');
    mockSignOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockClearFocusSession).toHaveBeenCalledTimes(1);
  });

  it('forgets the name the sign-in provider gave, so the next person on the phone is not offered it', async () => {
    mockSignOut.mockResolvedValue({ error: null });
    await signOut();
    expect(suggestedName()).toBeNull();
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
    expect(suggestedName()).toBe('Noa Levi');
  });

  it("didn't work when an expired session couldn't be refreshed and so stays stored", async () => {
    mockSignOut.mockResolvedValue({ error: offline });
    mockGetSession.mockResolvedValue({ data: { session: null }, error: offline });
    await expect(signOut()).rejects.toBe(offline);
    for (const clear of keptUntilSignedOut) expect(clear).not.toHaveBeenCalled();
  });
});
