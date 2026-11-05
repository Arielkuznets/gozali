import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import '@/i18n';
import SettingsScreen from '@/app/(app)/settings';
import en from '@/i18n/locales/en.json';

jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));
jest.mock('@/features/app/appConfig', () => ({ useAppConfig: () => ({ data: { apple_revocation: false } }) }));
jest.mock('@/features/auth/signIn', () => ({ deleteAccount: jest.fn(), isCancellation: () => false }));
jest.mock('@/features/profile/useProfile', () => ({
  NOTIFICATION_TYPES: ['nudge'],
  useProfile: () => ({ data: { notification_prefs: {}, reminder_time: '20:00:00' } }),
  useUpdateProfile: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/lib/notifications', () => ({ useNotificationPermission: () => ({ permission: 'granted', request: jest.fn() }) }));
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
}));

// The first drawing of the screen loads everything it imports.
jest.setTimeout(15_000);

/** Every string in a part of the locale, however deep. */
const strings = (node: unknown): string[] =>
  typeof node === 'string' ? [node] : Object.values(node as Record<string, unknown>).flatMap(strings);

/** The text on screen, without the names of the components that draw it. */
const drawn = (node: ReactTestRendererJSON | string): string[] =>
  typeof node === 'string' ? [node] : (node.children ?? []).flatMap(drawn);

async function settingsOn(os: typeof Platform.OS, version: string | number) {
  const platform = jest.replaceProperty(Platform, 'OS', os);
  const system = jest.spyOn(Platform, 'Version', 'get').mockReturnValue(version);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let screen!: ReactTestRenderer;
  await act(async () => {
    screen = create(
      <QueryClientProvider client={client}>
        <SettingsScreen />
      </QueryClientProvider>,
    );
  });
  const text = drawn(screen.toJSON() as ReactTestRendererJSON).join(' ');
  await act(async () => screen.unmount());
  client.clear();
  platform.restore();
  system.mockRestore();
  return text;
}

describe('how to add a widget', () => {
  it('gives the iPhone steps on iOS, without naming Android', async () => {
    const text = await settingsOn('ios', '17.0');

    expect(text).toContain('Add a widget');
    expect(text).toContain('Edit or +');
    expect(text).not.toContain('Android');
    expect(text).not.toContain('iPhone');
  });

  // The app is an iPhone app, which an iPad runs as well, and an iPad's home screen may not offer
  // the widget of an iPhone app.
  it('tells how to add the widget on a phone, which holds on an iPad too', async () => {
    const text = await settingsOn('ios', '27.0');

    expect(text).toContain('Add a widget on your phone: long-press its home screen');
  });

  // The widget extension needs iOS 17, and the app runs on iOS 16 as well.
  it('says on iOS 16 that widgets need iOS 17, instead of steps to a widget that is not there', async () => {
    const text = await settingsOn('ios', '16.7.10');

    expect(text).toContain('Widgets need iOS 17 or later.');
    expect(text).not.toContain('Add a widget');
  });

  it('gives the Android steps on Android, without naming iPhone', async () => {
    const text = await settingsOn('android', 34);

    expect(text).toContain('Add a widget');
    expect(text).toContain('tap Widgets');
    expect(text).not.toContain('iPhone');
    expect(text).not.toContain('Android');
  });
});

it('no text in the app names a phone platform, since the same text runs on both', () => {
  expect(strings(en).filter((text) => /android|iphone|ipad|google play|play store/i.test(text))).toEqual([]);
});
