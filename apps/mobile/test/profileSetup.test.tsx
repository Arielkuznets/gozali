import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import ProfileSetupScreen from '@/app/profile-setup';
import { Button } from '@/components/Button';
import { suggestName } from '@/features/profile/suggestedName';
import type { Profile } from '@/features/profile/useProfile';

jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } }, loading: false }) }));
jest.mock('@/features/auth/signIn', () => ({ signOut: async () => undefined }));
jest.mock('@/features/profile/AvatarButton', () => ({ AvatarButton: () => null }));
jest.mock('@/lib/push', () => ({}));
let mockProfile: Profile;
const mockUpdate = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: mockProfile, error: null }) }) }),
      update: (change: Partial<Profile>) => ({ eq: async () => mockUpdate(change) }),
    }),
  }),
}));

const newAccount = (display_name: string | null): Profile => ({
  id: 'noa',
  display_name,
  avatar_path: null,
  terms_accepted_at: null,
  timezone: 'UTC',
  locale: 'en',
  reminder_time: '20:00',
  notification_prefs: {},
});

let client: QueryClient;
let app: ReactTestRenderer;

/** The setup as the root layout opens it: once the profile is there. */
async function openSetup(profile: Profile) {
  mockProfile = profile;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  client.setQueryData(['profile', 'noa'], profile);
  await act(async () => {
    app = create(
      <QueryClientProvider client={client}>
        <ProfileSetupScreen />
      </QueryClientProvider>,
    );
  });
}

const nameField = () => app.root.findByType(TextInput);
const continueButton = () => app.root.findAllByType(Button).find(({ props }) => props.label === 'Continue')!;

async function tickAndContinue() {
  await act(async () => app.root.findByProps({ accessibilityRole: 'checkbox' }).props.onPress());
  expect(continueButton().props.disabled).toBe(false);
  await act(async () => continueButton().props.onPress());
}

beforeEach(() => {
  suggestName(null);
  mockUpdate.mockReset().mockResolvedValue({ error: null });
});

afterEach(async () => {
  await act(async () => app.unmount());
  client.clear();
});

describe('the name on the profile setup', () => {
  it('is the one the sign-in gave', async () => {
    suggestName('Noa Levi');
    await openSetup(newAccount(null));

    expect(nameField().props.value).toBe('Noa Levi');
  });

  it('is a default to keep or change when the sign-in gave none, so the tick alone goes on', async () => {
    await openSetup(newAccount(null));

    expect(nameField().props.value).toBe('Friend');
    await tickAndContinue();

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'Friend' }));
  });

  it('keeps an emoji at the end of the longest name whole', async () => {
    // 30 characters, as the server counts them, in 31 UTF-16 units.
    const name = `${'x'.repeat(29)}😀`;
    await openSetup(newAccount(name));

    expect(nameField().props.value).toBe(name);
    await tickAndContinue();

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ display_name: name }));
  });
});
