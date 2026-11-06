import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import MeScreen from '@/app/(app)/me';
import RootLayout from '@/app/_layout';
import ProfileSetupScreen from '@/app/profile-setup';
import { Button } from '@/components/Button';
import { SignOutLink } from '@/components/SignOutLink';
import '@/i18n';

// The three screens that offer Sign out, each with the real list of waiting feeds. Signing out
// itself is the stand-in here: what it deletes is sessionEnded.test.tsx's business.
const mockSignOut = jest.fn(async () => undefined);
jest.mock('@/features/auth/signIn', () => ({ signOut: () => mockSignOut() }));
jest.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ session: { user: { id: 'noa' } }, loading: false }),
}));
jest.mock('@/features/profile/useProfile', () => ({
  ...jest.requireActual('@/features/profile/useProfile'),
  useProfile: () => ({ isPending: false, isError: true, data: undefined }),
}));
jest.mock('@/features/profile/AvatarButton', () => ({ AvatarButton: () => null }));
jest.mock('@/lib/push', () => ({}));
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({ rpc: async () => ({ data: { totalFeeds: 0, currentStreak: 0, bestStreak: 0, days: [] }, error: null }) }),
}));

// The root layout around the screen for a profile that won't load, as in rootLayout.test.tsx.
jest.mock('@expo-google-fonts/rubik', () => ({ Rubik_400Regular: 1, Rubik_500Medium: 2, Rubik_700Bold: 3 }));
jest.mock('@expo-google-fonts/varela-round', () => ({ VarelaRound_400Regular: 4, useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => true, hide: () => undefined }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({
  router: { push: () => undefined },
  Stack: Object.assign(() => null, { Protected: () => null, Screen: () => null }),
}));
jest.mock('@/components/ErrorScreen', () => ({ ErrorScreen: () => null }));
jest.mock('@/components/UpdateRequired', () => ({ UpdateRequired: () => null }));
jest.mock('@/features/app/appConfig', () => ({ useAppConfig: () => ({}), installedVersion: () => '1.0.0', isOlder: () => false }));
jest.mock('@/features/packs/invites', () => ({ readInstallReferrer: async () => undefined }));
jest.mock('@/lib/appFocus', () => ({ refetchWhenAppReturns: () => undefined, useRefetchWhenClockMoves: () => undefined }));
jest.mock('@/lib/queryCache', () => ({
  KEEP_MS: 1000,
  persistOptions: { persister: { restoreClient: async () => undefined, persistClient: async () => undefined, removeClient: async () => undefined } },
}));
jest.mock('@/lib/reportError', () => ({ watchForCrashes: () => undefined }));

const QUEUE_KEY = 'gozali.feed-queue';

const feed = (id: string) => ({
  id,
  packId: 'pack',
  userId: 'noa',
  photoUri: `documents/feed-queue/${id}.jpg`,
  caption: null,
  capturedAt: '2026-11-01T20:00:00Z',
  focusMinutes: null,
  extra: false,
});

const keep = (...feeds: object[]) => AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(feeds));

let client: QueryClient;
let app: ReactTestRenderer;

const inClient = (screen: ReactElement) => <QueryClientProvider client={client}>{screen}</QueryClientProvider>;

/** Lets what a tap started finish. */
const settle = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });

async function open(screen: ReactElement) {
  await act(async () => {
    app = create(screen);
  });
  await settle();
}

const link = () => app.root.findByType(SignOutLink).props.onPress;
const button = () => app.root.findAllByType(Button).find(({ props }) => props.label === 'Sign out')?.props.onPress;

function question() {
  const [title, message, buttons] = jest.mocked(Alert.alert).mock.calls[0] ?? [];
  const tap = (style: AlertButton['style']) =>
    act(async () => {
      (buttons as AlertButton[]).find((button) => button.style === style)?.onPress?.();
    });
  return { title, message, cancel: () => tap('cancel'), confirm: () => tap('destructive') };
}

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  await AsyncStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockSignOut.mockClear();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe.each([
  ['the screen for a profile that will not load', () => <RootLayout />, link],
  ['the Me screen', () => inClient(<MeScreen />), button],
  ['the profile setup', () => inClient(<ProfileSetupScreen />), link],
])('Sign out on %s', (_name, screen, signOut) => {
  const tap = () => act(async () => signOut()());

  it('signs out at once with nothing waiting', async () => {
    await open(screen());

    await tap();
    await settle();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('asks first with a feed waiting, and cancelling keeps it and the session', async () => {
    await keep(feed('a'));
    await open(screen());

    await tap();
    await settle();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(question().title).toBe('Sign out?');
    expect(question().message).toBe("1 feed hasn't gone out yet. Signing out deletes it and its photo.");

    await question().cancel();
    await settle();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(QUEUE_KEY))!)).toEqual([feed('a')]);
  });

  it('signs out once the person says so, and says how many go', async () => {
    await keep(feed('a'), feed('b'));
    await open(screen());

    await tap();
    await settle();
    expect(question().message).toBe("2 feeds haven't gone out yet. Signing out deletes them and their photos.");

    await question().confirm();
    await settle();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("doesn't count a dropped feed that only waits for the member to hear of it", async () => {
    await keep({ ...feed('a'), droppedFor: 'not_a_member' });
    await open(screen());

    await tap();
    await settle();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("leaves out another account's feeds, which stay where they are", async () => {
    await keep({ ...feed('a'), userId: 'dan' });
    await open(screen());

    await tap();
    await settle();

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("still signs out when the list can't be read", async () => {
    await open(screen());
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('Database or disk is full'));

    await tap();
    await settle();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('starts once however fast the taps come', async () => {
    await open(screen());

    await act(async () => {
      signOut()();
      signOut()();
    });
    await settle();

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
