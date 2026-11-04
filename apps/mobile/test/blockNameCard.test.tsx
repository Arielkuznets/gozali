import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import { NameMeCard } from '@/features/social/NameMeCard';
import { useBlock } from '@/features/social/api';

// The real card and block over a stand-in for the server, which leaves out the suggestions of
// someone the reader blocked. A read answers with the rows as they stood when it went out, once the
// test lets it answer.
let mockBlocked = false;
let mockHeld: Promise<void> = Promise.resolve();
jest.mock('@/lib/supabase', () => ({
  requireSupabase: () => ({
    from: (table: string) => {
      if (table === 'blocks') {
        return {
          upsert: async () => {
            mockBlocked = true;
            return { error: null };
          },
        };
      }
      const dans = { id: 's1', user_id: 'dan', name: 'Biscuit', created_at: '2026-11-01T10:00:00Z' };
      const noas = { id: 's2', user_id: 'noa', name: 'Mochi', created_at: '2026-11-01T11:00:00Z' };
      const rows = mockBlocked ? [noas] : [dans, noas];
      const held = mockHeld;
      const read: Record<string, unknown> = {
        then: (done: (answer: unknown) => unknown, failed: (error: unknown) => unknown) =>
          held.then(() => ({ data: rows, error: null })).then(done, failed),
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

let block: ReturnType<typeof useBlock>;

function PackScreen() {
  const current = useBlock();
  useEffect(() => {
    block = current;
  });
  return (
    <NameMeCard
      packId="pack"
      critter="Kit"
      isAdmin
      adminName="Noa"
      names={
        new Map([
          ['dan', 'Dan'],
          ['noa', 'Noa'],
        ])
      }
    />
  );
}

let tree: ReactTestRenderer;

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const texts = () => tree.root.findAll((node) => node.type === 'Text').map((node) => [node.props.children].flat().join(''));

afterEach(async () => {
  await act(async () => tree.unmount());
});

describe('a block while the name card is still loading', () => {
  it("leaves out the member's suggestions that the read on its way brings", async () => {
    let answer = () => {};
    mockHeld = new Promise((resolve) => {
      answer = resolve;
    });
    await act(async () => {
      tree = create(
        // Reads are never collected and the block is at once, so no timer outlives the test.
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false }, mutations: { gcTime: 0 } } })}>
          <PackScreen />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await block.mutateAsync({ blockerId: 'noa', blockedId: 'dan' });
    });
    await settle();
    answer();
    await settle();

    expect(texts()).toContain('Mochi');
    expect(texts()).not.toContain('Biscuit');
    expect(texts()).not.toContain('by Dan');
  });
});
