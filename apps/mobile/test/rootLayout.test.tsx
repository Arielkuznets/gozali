import { useQuery } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import RootLayout from '@/app/_layout';
import { clearShotFiles } from '@/features/feeds/queue';
import { noteServerDate } from '@/lib/serverClock';

// The real root layout with nobody signed in, so the fonts are all that holds the splash up.
let mockFonts: [boolean, Error | null];
let mockOnScreen: ReactNode;

jest.mock('@expo-google-fonts/rubik', () => ({ Rubik_400Regular: 1, Rubik_500Medium: 2, Rubik_700Bold: 3 }));
jest.mock('@expo-google-fonts/varela-round', () => ({ VarelaRound_400Regular: 4, useFonts: () => mockFonts }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: async () => true, hide: jest.fn() }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-router', () => ({ Stack: Object.assign(() => mockOnScreen, { Protected: () => null, Screen: () => null }) }));
jest.mock('@/i18n', () => ({}));
jest.mock('@/components/ErrorScreen', () => ({ ErrorScreen: () => null }));
jest.mock('@/components/UpdateRequired', () => ({ UpdateRequired: () => null }));
jest.mock('@/features/app/appConfig', () => ({ useAppConfig: () => ({}), installedVersion: () => '1.0.0', isOlder: () => false }));
jest.mock('@/features/auth/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ session: null, loading: false }),
}));
jest.mock('@/features/auth/signIn', () => ({}));
jest.mock('@/features/feeds/queue', () => ({ clearShotFiles: jest.fn() }));
jest.mock('@/features/packs/invites', () => ({ readInstallReferrer: async () => undefined }));
jest.mock('@/features/profile/useProfile', () => ({
  useProfile: () => ({ isPending: true, isError: false }),
  useSignedOutSync: () => undefined,
  isProfileComplete: () => false,
}));
jest.mock('@/lib/queryCache', () => ({
  KEEP_MS: 1000,
  persistOptions: { persister: { restoreClient: async () => undefined, persistClient: async () => undefined, removeClient: async () => undefined } },
}));
jest.mock('@/lib/reportError', () => ({ watchForCrashes: () => undefined }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

let app: ReactTestRenderer | undefined;

async function open() {
  await act(async () => {
    app = create(<RootLayout />);
    await settle();
  });
  return JSON.stringify(app?.toJSON());
}

beforeEach(() => {
  mockOnScreen = 'the app';
  jest.mocked(SplashScreen.hide).mockClear();
});

it('clears the photo files of earlier runs once, however often it draws', async () => {
  mockFonts = [true, null];
  await open();
  await open();
  expect(clearShotFiles).toHaveBeenCalledTimes(1);
});

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

describe('what is on screen', () => {
  const read = jest.fn(async () => 'from the server');

  function Reader() {
    useQuery({ queryKey: ['read'], queryFn: read });
    return null;
  }

  const hearServer = (ahead: number) =>
    act(async () => {
      noteServerDate(new Date(Date.now() + ahead).toUTCString(), Date.now(), Date.now());
      await settle();
    });

  const phoneReports = (state: AppStateStatus) =>
    act(async () => {
      jest.mocked(AppState.addEventListener).mock.calls.forEach(([, listener]) => listener(state));
      await settle();
    });

  beforeEach(async () => {
    read.mockClear();
    mockFonts = [true, null];
    mockOnScreen = <Reader />;
    await open();
    expect(read).toHaveBeenCalledTimes(1);
  });

  afterEach(async () => {
    await hearServer(0);
    await act(async () => app?.unmount());
  });

  it('is read again when an answer shows the phone clock moved', async () => {
    await hearServer(3 * 60 * 60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('is read again after a return to the app', async () => {
    await phoneReports('background');
    await phoneReports('active');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
