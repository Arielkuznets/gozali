import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

// The modules Android starts on its own, with the real auth-js and the app's own client within
// reach, against a stand-in for the server.
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://gozali.test';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable';

jest.mock('react-native-android-widget', () => ({}));

const mockLoaded = jest.fn();
jest.mock('@/lib/supabase', () => {
  mockLoaded();
  return jest.requireActual('@/lib/supabase');
});

const update = {
  widgetInfo: { widgetName: 'PackSmall', widgetId: 7 },
  widgetAction: 'WIDGET_UPDATE',
  renderWidget: () => undefined,
} as unknown as WidgetTaskHandlerProps;

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('a widget update with nobody using the phone', () => {
  // Creating the client refreshes a session near its end, and Android starts this about every half
  // hour.
  it('asks the server for the widget state and leaves the session alone', async () => {
    await AsyncStorage.multiSet([
      ['gozali.widget-token', 'a-token'],
      [
        'sb-gozali-auth-token',
        JSON.stringify({
          access_token: 'old',
          refresh_token: 'old-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: nowSeconds() + 30,
          user: { id: 'noa', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
        }),
      ],
    ]);
    const requests: string[] = [];
    globalThis.fetch = (async (input: string) => {
      const { pathname, search } = new URL(input);
      requests.push(pathname + search);
      return new Response(JSON.stringify({ timezone: 'UTC', fetchedAt: new Date().toISOString(), packs: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // The widget modules, as every start of the app loads them.
    jest.requireActual('@/features/widgets/android/configure');
    const { widgetTaskHandler } = jest.requireActual<typeof import('@/features/widgets/android/task')>('@/features/widgets/android/task');
    await widgetTaskHandler(update);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(requests).toEqual(['/functions/v1/widget-state']);
    expect(mockLoaded).not.toHaveBeenCalled();
  });
});
