import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { NameMeCard } from '@/features/social/NameMeCard';
import { confirm } from '@/lib/confirm';

// The real card and hooks over a stand-in for the server.
let mockFails = false;
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => {
      const read: Record<string, unknown> = {
        then: (done: (answer: unknown) => unknown, failed: (error: unknown) => unknown) =>
          Promise.resolve(
            mockFails
              ? { data: null, error: new TypeError('Network request failed') }
              : { data: [{ id: 's1', user_id: 'dan', name: 'Biscuit', created_at: '2026-11-01T10:00:00Z' }], error: null },
          ).then(done, failed),
      };
      for (const step of ['select', 'eq', 'order']) read[step] = () => read;
      return read;
    },
  }),
}));
jest.mock('@/lib/confirm', () => ({ confirm: jest.fn(), notify: jest.fn() }));
jest.mock('@/features/feeds/queue', () => ({}));
jest.mock('@/features/feeds/send', () => ({}));
jest.mock('@react-native-community/netinfo', () => ({}));

const LOAD_FAILED = "This didn't load. Check the connection and try again.";

let tree: ReactTestRenderer;

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const texts = () => tree.root.findAll((node) => node.type === 'Text').map((node) => [node.props.children].flat().join(''));

beforeEach(async () => {
  mockFails = true;
  mockRpc.mockReset().mockResolvedValue({ error: null });
  jest.mocked(confirm).mockReset();
  await act(async () => {
    tree = create(
      // No garbage collection, whose timers would outlive the test.
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })}>
        <NameMeCard packId="pack" critter="Kit" isAdmin adminName="Noa" names={new Map([['dan', 'Dan']])} />
      </QueryClientProvider>,
    );
  });
  await settle();
});

afterEach(async () => {
  await act(async () => tree.unmount());
});

describe('the name card when the suggestions did not load', () => {
  it('says so, and Try again brings them to pick from', async () => {
    expect(texts()).toContain(LOAD_FAILED);

    mockFails = false;
    await act(async () => tree.root.findAll((node) => node.props.label === 'Try again' && node.props.onPress)[0]?.props.onPress());
    await settle();

    expect(texts()).not.toContain(LOAD_FAILED);
    expect(texts()).toContain('Biscuit');
  });
});

describe('Pick on a suggestion', () => {
  const pick = () => tree.root.findAll((node) => node.props.label === 'Pick' && node.props.onPress)[0]!;

  beforeEach(async () => {
    mockFails = false;
    await act(async () => tree.root.findAll((node) => node.props.label === 'Try again' && node.props.onPress)[0]?.props.onPress());
    await settle();
  });

  it('asks first, since a name is for good, and Cancel names nothing', async () => {
    await act(async () => pick().props.onPress());
    await settle();

    expect(jest.mocked(confirm).mock.calls).toEqual([
      [expect.objectContaining({ title: 'Name it Biscuit?', message: "A name can't be changed later." })],
    ]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('names the pet once the admin says yes', async () => {
    await act(async () => pick().props.onPress());
    await act(async () => jest.mocked(confirm).mock.calls[0]![0].onConfirm());
    await settle();

    expect(mockRpc.mock.calls).toEqual([['choose_name', { target: 'pack', suggestion: 's1' }]]);
  });
});
