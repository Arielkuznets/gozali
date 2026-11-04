import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import '@/i18n';
import NotTodayScreen from '@/app/(app)/pack/[id]/not-today';
import { Button } from '@/components/Button';
import { PauseSection } from '@/features/days/PauseSection';
import { confirm, notify } from '@/lib/confirm';

// The real screen, hooks and query client; only the server stands in, and takes a moment to answer.
const mockGoBack = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/components/ActionMenu', () => ({ ActionMenu: () => null }));
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'pack' }),
  useNavigation: () => ({ isFocused: () => true }),
}));
jest.mock('@/lib/navigation', () => ({ goBack: (...args: unknown[]) => mockGoBack(...args) }));
jest.mock('@/lib/confirm', () => ({ confirm: jest.fn(), notify: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ requireSupabase: () => ({ rpc: (...args: unknown[]) => mockRpc(...args) }) }));
jest.mock('@/features/packs/api', () => ({ usePack: () => ({ data: { id: 'pack', timezone: 'UTC' } }) }));

const ANSWER_MS = 100;
const later = <T,>(value: T) => new Promise<T>((done) => setTimeout(() => done(value), ANSWER_MS));

let pass: 'rest' | 'joker' | null;
let pause: { startsOn: string; endsOn: string } | null;
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
  pause = null;
  jest.mocked(notify).mockReset();
  // Yes to every question, unless a test says otherwise.
  jest.mocked(confirm).mockReset().mockImplementation(({ onConfirm }) => onConfirm());
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
        pause,
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

async function open(screen = <NotTodayScreen />) {
  await act(async () => {
    tree = create(<QueryClientProvider client={client}>{screen}</QueryClientProvider>);
  });
  await advance(ANSWER_MS + 1);
}

describe('End pause tapped twice before the button can turn off', () => {
  it('ends the pause once, with no refusal', async () => {
    pause = { startsOn: '2026-10-20', endsOn: '2026-12-01' };
    await open(<PauseSection packId="pack" />);
    const answer = mockRpc.getMockImplementation()!;
    mockRpc.mockImplementation((name: string, ...args: unknown[]) => {
      if (name !== 'end_pause') return answer(name, ...args);
      const ended = pause === null;
      pause = null;
      return later({ data: null, error: ended ? { message: 'not_paused' } : null });
    });

    await act(async () => {
      const [end] = buttons('End pause');
      end!.props.onPress();
      end!.props.onPress();
    });
    await advance(ANSWER_MS * 2 + 1);

    expect(mockRpc.mock.calls.filter(([name]) => name === 'end_pause')).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('End pause', () => {
  const endCalls = () => mockRpc.mock.calls.filter(([name]) => name === 'end_pause');

  it('asks first on a running pause, and Cancel keeps it', async () => {
    pause = { startsOn: '2026-10-20', endsOn: '2026-12-01' };
    jest.mocked(confirm).mockImplementation(() => undefined);
    await open(<PauseSection packId="pack" />);

    await act(async () => buttons('End pause')[0]!.props.onPress());
    await advance(ANSWER_MS + 1);

    expect(jest.mocked(confirm).mock.calls).toEqual([
      [
        expect.objectContaining({
          title: 'End your pause now?',
          message: 'You count again from today, and your next pause can start in 30 days.',
        }),
      ],
    ]);
    expect(endCalls()).toHaveLength(0);
    expect(buttons('End pause')).toHaveLength(1);
  });

  it('cancels a pause that has not started with one tap', async () => {
    pause = { startsOn: '2026-11-02', endsOn: '2026-11-10' };
    jest.mocked(confirm).mockImplementation(() => undefined);
    await open(<PauseSection packId="pack" />);

    await act(async () => buttons('Cancel pause')[0]!.props.onPress());

    expect(confirm).not.toHaveBeenCalled();
    expect(endCalls()).toHaveLength(1);
  });
});

describe('Not today', () => {
  it('offers a way out while it loads and once it failed', async () => {
    mockRpc.mockImplementation(() => later({ data: null, error: new TypeError('Network request failed') }));

    await open();
    expect(buttons('Use')).toHaveLength(0);
    expect(buttons('Close')).toHaveLength(1);

    // Past the retries.
    await advance(10_000);
    expect(buttons('Try again')).toHaveLength(1);
    expect(buttons('Close')).toHaveLength(1);

    await act(async () => buttons('Close')[0]!.props.onPress());
    expect(mockGoBack).toHaveBeenCalledWith('/pack/pack');
  });

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

  describe('tapped twice before the button can turn off', () => {
    const useCalls = () => mockRpc.mock.calls.filter(([name]) => name === 'use_day_pass');

    beforeEach(async () => {
      await open();
      const answer = mockRpc.getMockImplementation()!;
      mockRpc.mockImplementation((name: string, ...args: unknown[]) =>
        name === 'use_day_pass' && pass !== null
          ? later({ data: null, error: { message: 'already_passed' } })
          : answer(name, ...args),
      );
      await act(async () => {
        const [use] = buttons('Use');
        use!.props.onPress();
        use!.props.onPress();
      });
    });

    it('saves the rest day once, and closes the screen with no refusal', async () => {
      await advance(ANSWER_MS * 2 + 1);

      expect(useCalls()).toHaveLength(1);
      expect(notify).not.toHaveBeenCalled();
      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
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

    it('takes a tap on the other Use after that', async () => {
      await tapUseAndRefuse();
      await advance(ANSWER_MS * 2 + 1);
      mockRpc.mockClear();

      await act(async () => buttons('Use')[1]!.props.onPress());

      expect(mockRpc).toHaveBeenCalledWith('use_day_pass', { target: 'pack', pass: 'joker' });
    });
  });
});
