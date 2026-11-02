import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import NotTodayScreen from '@/app/(app)/pack/[id]/not-today';
import { Button } from '@/components/Button';
import { notify } from '@/lib/confirm';

// The real screen, hooks and query client; only the server stands in, and takes a moment to answer.
const mockGoBack = jest.fn();
const mockRpc = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'pack' }),
  useNavigation: () => ({ isFocused: () => true }),
}));
jest.mock('@/lib/navigation', () => ({ goBack: (...args: unknown[]) => mockGoBack(...args) }));
jest.mock('@/lib/confirm', () => ({ notify: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }) }));
jest.mock('@/features/packs/api', () => ({ usePack: () => ({ data: { id: 'pack', timezone: 'UTC' } }) }));

const ANSWER_MS = 100;
const later = <T,>(value: T) => new Promise<T>((done) => setTimeout(() => done(value), ANSWER_MS));

let pass: 'rest' | 'joker' | null;
let tree: ReactTestRenderer;
let client: QueryClient;

const buttons = (label: string) => tree.root.findAllByType(Button).filter((node) => node.props.label === label);

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
  pass = null;
  jest.mocked(notify).mockReset();
  mockGoBack.mockReset();
  mockRpc.mockReset().mockImplementation((name: string) => {
    if (name === 'use_day_pass') pass = 'rest';
    if (name === 'cancel_day_pass') pass = null;
    if (name !== 'my_day_status') return later({ data: null, error: null });
    return later({
      data: {
        day: '2026-11-01',
        restDaysPerWeek: 2,
        restDaysLeft: 2,
        jokerAvailable: true,
        passToday: pass,
        fedToday: false,
        pause: null,
        pauseAvailableFrom: null,
      },
      error: null,
    });
  });
  client = new QueryClient();
});

afterEach(async () => {
  await act(async () => {
    tree.unmount();
    client.clear();
  });
  jest.useRealTimers();
});

async function open() {
  await act(async () => {
    tree = create(
      <QueryClientProvider client={client}>
        <NotTodayScreen />
      </QueryClientProvider>,
    );
  });
  await advance(ANSWER_MS + 1);
}

describe('Not today', () => {
  it('shows a spinner on the Use that was tapped until the screen closes', async () => {
    await open();
    await act(async () => buttons('Use')[1]!.props.onPress());
    await advance(ANSWER_MS / 2);
    expect(buttons('Use')[0]!.props.loading).toBeFalsy();
    expect(buttons('Use')[1]!.props.loading).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();

    // The server said yes; today's status is still on its way.
    await advance(ANSWER_MS);
    expect(buttons('Use')[1]!.props.loading).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();

    await advance(ANSWER_MS);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('takes the other Use out of reach meanwhile', async () => {
    await open();
    await act(async () => buttons('Use')[0]!.props.onPress());
    await advance(ANSWER_MS / 2);
    expect(buttons('Use')[0]!.props.loading).toBe(true);
    expect(buttons('Use')[1]!.props.disabled).toBe(true);
  });

  it('keeps the spinner on Undo until the card has changed', async () => {
    pass = 'rest';
    await open();
    await act(async () => buttons('Undo')[0]!.props.onPress());
    // The server said yes; today's status is still on its way.
    await advance(ANSWER_MS + 20);
    expect(buttons('Undo')[0]!.props.loading).toBe(true);

    await advance(ANSWER_MS);
    expect(buttons('Undo')).toHaveLength(0);
    expect(buttons('Use')).toHaveLength(2);
  });

  describe('when the server refuses', () => {
    const REFUSED = 'No rest days left this week.';

    async function tapUseAndRefuse() {
      await open();
      mockRpc.mockImplementation(() => later({ data: null, error: { message: 'no_rest_days_left' } }));
      await act(async () => buttons('Use')[0]!.props.onPress());
    }

    it('says so once, with the screen still open', async () => {
      await tapUseAndRefuse();
      await advance(ANSWER_MS + 1);

      expect(jest.mocked(notify).mock.calls).toEqual([[REFUSED]]);
      expect(mockGoBack).not.toHaveBeenCalled();
    });

    it('says so even when the screen closed on the way', async () => {
      await tapUseAndRefuse();
      await act(async () => tree.unmount());
      await advance(ANSWER_MS + 1);

      expect(jest.mocked(notify).mock.calls).toEqual([[REFUSED]]);
    });
  });
});
