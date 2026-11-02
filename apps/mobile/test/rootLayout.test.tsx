import * as SplashScreen from 'expo-splash-screen';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import RootLayout from '@/app/_layout';

// The real root layout with nobody signed in, so the fonts are all that holds the splash up.
let mockFonts: [boolean, Error | null];

jest.mock('@expo-google-fonts/rubik', () => ({ Rubik_400Regular: 1, Rubik_500Medium: 2, Rubik_700Bold: 3 }));
jest.mock('@expo-google-fonts/varela-round', () => ({ VarelaRound_400Regular: 4, useFonts: () => mockFonts }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => true, hide: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({ Stack: Object.assign(() => 'the app', { Protected: () => null, Screen: () => null }) }));
jest.mock('@/i18n', () => ({}));
jest.mock('@/components/ErrorScreen', () => ({ ErrorScreen: () => null }));
jest.mock('@/components/UpdateRequired', () => ({ UpdateRequired: () => null }));
jest.mock('@/features/app/appConfig', () => ({ useAppConfig: () => ({}), installedVersion: () => '1.0.0', isOlder: () => false }));
jest.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ session: null, loading: false }),
}));
jest.mock('@/features/auth/signIn', () => ({}));
jest.mock('@/features/packs/invites', () => ({ readInstallReferrer: async () => undefined }));
jest.mock('@/features/profile/useProfile', () => ({
  useProfile: () => ({ isPending: true, isError: false }),
  useSignedOutSync: () => undefined,
  isProfileComplete: () => false,
}));
jest.mock('@/lib/appFocus', () => ({ refetchWhenAppReturns: () => undefined, useRefetchWhenClockMoves: () => undefined }));
jest.mock('@/lib/queryCache', () => ({
  KEEP_MS: 1000,
  persistOptions: { persister: { restoreClient: async () => undefined, persistClient: async () => undefined, removeClient: async () => undefined } },
}));
jest.mock('@/lib/reportError', () => ({ watchForCrashes: () => undefined }));

async function open() {
  let app: ReactTestRenderer | undefined;
  await act(async () => {
    app = create(<RootLayout />);
  });
  return JSON.stringify(app?.toJSON());
}

beforeEach(() => jest.mocked(SplashScreen.hide).mockClear());

it('keeps the splash up while the fonts load', async () => {
  mockFonts = [false, null];
  expect(await open()).not.toContain('the app');
  expect(SplashScreen.hide).not.toHaveBeenCalled();
});

it('opens the app when the fonts have loaded', async () => {
  mockFonts = [true, null];
  expect(await open()).toContain('the app');
  expect(SplashScreen.hide).toHaveBeenCalled();
});

it('opens the app when a font fails to load', async () => {
  mockFonts = [false, new Error('Unable to download asset')];
  expect(await open()).toContain('the app');
  expect(SplashScreen.hide).toHaveBeenCalled();
});
