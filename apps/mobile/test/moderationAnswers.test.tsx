import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import type { MenuAction } from '@/components/ActionMenu';
import { useModeration } from '@/features/social/moderation';

jest.mock('expo-file-system', () => ({ File: class {}, Directory: class {}, Paths: {} }));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({ fetch: jest.fn(), addEventListener: () => () => undefined }));
jest.mock('@/lib/push', () => ({}));
jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } } }) }));

let mockAnswer: (answer: { error: unknown }) => void;
const mockSaved = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: null,
  storedSession: async () => null,
  requireSupabase: () => ({
    from: (table: string) => ({
      upsert: (row: unknown) => {
        mockSaved(table, row);
        return new Promise((resolve) => {
          mockAnswer = resolve;
        });
      },
    }),
  }),
}));

const BLOCKED = 'Blocked. You can also leave this pack from its settings, where its admin can remove them.';
const REPORTED = 'Thanks. We will look at it within 24 hours.';
const FAILED = "Saving didn't work. Please try again.";
const PHOTO = { id: 'photo', userId: 'dan', name: 'Dan', url: 'https://photo/1', caption: null };

let moderation: ReturnType<typeof useModeration>;

function PackScreen() {
  const current = useModeration();
  useEffect(() => {
    moderation = current;
  });
  return null;
}

let screen: ReactTestRenderer;
let client: QueryClient;
let alert: jest.SpyInstance<void, Parameters<typeof Alert.alert>>;

// An observer hears about a change in a macrotask, so an act with nothing to wait for looks too early.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

/** Picks the action in its menu and says yes to the question it asks. */
async function choose(action: MenuAction) {
  await act(async () => action.onPress());
  const yes = alert.mock.lastCall?.[2]?.find((button) => button.style === 'destructive');
  await act(async () => yes?.onPress?.());
  await settle();
  expect(mockSaved).toHaveBeenCalledTimes(1);
  alert.mockClear();
}

/** What the person is told after the question. */
const told = () => alert.mock.calls.map(([message]) => message);

beforeEach(async () => {
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockSaved.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  await act(async () => {
    screen = create(
      <QueryClientProvider client={client}>
        <PackScreen />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => screen.unmount());
  client.clear();
  jest.restoreAllMocks();
});

const photoAction = (label: string) => moderation.photoMenu(PHOTO).actions.find((action) => action.label === label)!;

describe('the menu of a photo someone else posted', () => {
  // Someone who left or was removed has no circle to press, only their posts.
  it('offers to report its poster too', () => {
    expect(moderation.photoMenu(PHOTO).actions.map((action) => action.label)).toEqual(['Report photo', 'Report Dan', 'Block Dan']);
  });
});

describe.each<[string, () => MenuAction, string]>([
  ['a block from a member menu', () => moderation.memberActions('dan', 'Dan')[1]!, BLOCKED],
  ['a block from a photo menu', () => photoAction('Block Dan'), BLOCKED],
  ['a report of a member', () => moderation.memberActions('dan', 'Dan')[0]!, REPORTED],
  ['a report of a member from a photo menu', () => photoAction('Report Dan'), REPORTED],
  ['a report of a photo', () => photoAction('Report photo'), REPORTED],
])('%s', (_name, action, saved) => {
  it('says it saved, once, with the screen still open', async () => {
    await choose(action());
    await act(async () => mockAnswer({ error: null }));
    await settle();

    expect(told()).toEqual([saved]);
  });

  it('says it saved after the screen closed', async () => {
    await choose(action());
    await act(async () => screen.unmount());
    await act(async () => mockAnswer({ error: null }));
    await settle();

    expect(told()).toEqual([saved]);
  });

  it("says it didn't save after the screen closed", async () => {
    await choose(action());
    await act(async () => screen.unmount());
    await act(async () => mockAnswer({ error: { message: 'TypeError: Network request failed', code: '' } }));
    await settle();

    expect(told()).toEqual([FAILED]);
  });
});
