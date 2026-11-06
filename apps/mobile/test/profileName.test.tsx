import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Pack, PackMember } from '@/features/packs/api';
import { useUpdateProfile, type ProfileSettings } from '@/features/profile/useProfile';

jest.mock('@/features/auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'noa' } }, loading: false }) }));
jest.mock('@/lib/push', () => ({}));

const mockUpdate = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: () => ({ update: (settings: unknown) => ({ eq: () => mockUpdate(settings) }) }),
  }),
}));

const member = (user_id: string, display_name: string | null): PackMember => ({
  user_id,
  role: 'member',
  status: 'active',
  joined_at: '2026-10-01T10:00:00Z',
  profiles: display_name === null ? null : { display_name, avatar_path: 'a.jpg' },
});

const packWith = (id: string, ...members: PackMember[]) => ({ id, pack_members: members }) as Pack;

const namesIn = (pack: Pack | null | undefined) => pack?.pack_members.map((row) => row.profiles?.display_name ?? null);

describe('the packs the phone holds', () => {
  let client: QueryClient;
  let app: ReactTestRenderer;
  let change: (settings: ProfileSettings) => void;

  function Settings() {
    change = useUpdateProfile().mutate;
    return null;
  }

  async function saveChange(settings: ProfileSettings) {
    await act(async () => {
      change(settings);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  beforeEach(async () => {
    mockUpdate.mockReset().mockResolvedValue({ error: null });
    // No garbage collection, whose timers would outlive the test.
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    client.setQueryData(['packs'], [packWith('p1', member('noa', 'Noa'), member('dan', 'Dan')), packWith('p2', member('noa', 'Noa'))]);
    client.setQueryData(['packs', 'p1'], packWith('p1', member('noa', 'Noa'), member('dan', 'Dan')));
    client.setQueryData(['packs', 'gone'], null);
    await act(async () => {
      app = create(
        <QueryClientProvider client={client}>
          <Settings />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(async () => {
    await act(async () => app.unmount());
    client.clear();
  });

  it('take a new name, in that member row only', async () => {
    await saveChange({ display_name: 'Noa K' });

    const list = client.getQueryData<Pack[]>(['packs']);
    expect(list?.map(namesIn)).toEqual([['Noa K', 'Dan'], ['Noa K']]);
    expect(namesIn(client.getQueryData<Pack>(['packs', 'p1']))).toEqual(['Noa K', 'Dan']);
    expect(client.getQueryData(['packs', 'gone'])).toBeNull();
  });

  it('keep the rest of the member row', async () => {
    await saveChange({ display_name: 'Noa K' });

    expect(client.getQueryData<Pack>(['packs', 'p1'])?.pack_members[0]?.profiles).toEqual({
      display_name: 'Noa K',
      avatar_path: 'a.jpg',
    });
  });

  it('leave a member row with no profile to show', async () => {
    client.setQueryData(['packs', 'p1'], packWith('p1', member('noa', null)));

    await saveChange({ display_name: 'Noa K' });

    expect(namesIn(client.getQueryData<Pack>(['packs', 'p1']))).toEqual([null]);
  });

  it('keep the old name when the server turns the new one down', async () => {
    mockUpdate.mockResolvedValue({ error: { message: 'text_not_allowed' } });

    await saveChange({ display_name: 'Noa K' });

    expect(namesIn(client.getQueryData<Pack>(['packs', 'p1']))).toEqual(['Noa', 'Dan']);
  });

  it('stay as they are for any other change to the profile', async () => {
    const list = client.getQueryData(['packs']);

    await saveChange({ reminder_time: '20:00' });

    expect(client.getQueryData(['packs'])).toBe(list);
  });
});
