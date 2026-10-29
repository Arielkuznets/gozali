import { signInWithBrowser } from '@/features/auth/signIn';

// The rest of the sign-in module, which these tests don't reach.
jest.mock('@/lib/push', () => ({}));
jest.mock('@/features/widgets/sync', () => ({}));
jest.mock('@/features/focus/session', () => ({}));
jest.mock('@/lib/notifications', () => ({}));
jest.mock('@/features/feeds/queue', () => ({}));
// The real ones need the app's manifest to know its scheme.
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `gozali://${path}`,
  parse: (url: string) => ({ queryParams: Object.fromEntries(new URL(url).searchParams) }),
}));
const mockOpenAuthSession = jest.fn();
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args) }));
const mockExchange = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    auth: {
      signInWithOAuth: async () => ({ data: { url: 'https://auth.test/authorize?provider=apple' }, error: null }),
      exchangeCodeForSession: (...args: unknown[]) => mockExchange(...args),
    },
  }),
}));

beforeEach(() => {
  mockOpenAuthSession.mockReset();
  mockExchange.mockReset().mockResolvedValue({ error: null });
});

describe('signing in through the browser', () => {
  it('trades the code from the link for a session', async () => {
    mockOpenAuthSession.mockResolvedValue({ type: 'success', url: 'gozali://auth/callback?code=one-time' });
    await signInWithBrowser('apple');
    expect(mockExchange).toHaveBeenCalledWith('one-time');
  });

  it('fails with the reason the auth server put in the link', async () => {
    mockOpenAuthSession.mockResolvedValue({
      type: 'success',
      url: 'gozali://auth/callback?error=invalid_request&error_code=bad_oauth_callback&error_description=OAuth+state+parameter+missing',
    });
    await expect(signInWithBrowser('apple')).rejects.toMatchObject({
      message: 'OAuth state parameter missing',
      code: 'bad_oauth_callback',
    });
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
