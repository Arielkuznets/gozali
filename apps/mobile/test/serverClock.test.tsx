import { focusManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useRefetchWhenClockMoves } from '@/lib/appFocus';
import { persistOptions } from '@/lib/queryCache';
import { clockedFetch, noteServerDate, onServerClockChange, serverNow } from '@/lib/serverClock';
import { useNow } from '@/lib/useNow';

jest.mock('@/lib/supabase', () => ({ storedSession: async () => ({ user: { id: 'noa' } }) }));

const at = (iso: string) => Date.parse(iso);

describe("the server's clock", () => {
  afterEach(() => {
    jest.useRealTimers();
    noteServerDate(new Date().toUTCString(), Date.now(), Date.now());
  });

  it('corrects a phone set three hours behind', () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    // The server answered at 12:00, halfway through a request that took a second on the phone.
    noteServerDate('Thu, 29 Oct 2026 12:00:00 GMT', at('2026-10-29T08:59:59.5Z'), at('2026-10-29T09:00:00.5Z'));
    expect(serverNow().toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it('leaves a phone a few seconds off alone', () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    noteServerDate('Thu, 29 Oct 2026 09:00:20 GMT', at('2026-10-29T09:00:00Z'), at('2026-10-29T09:00:00Z'));
    expect(serverNow().toISOString()).toBe('2026-10-29T09:00:00.000Z');
  });

  it('ignores an answer without a readable date', () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    noteServerDate('Thu, 29 Oct 2026 12:00:00 GMT', at('2026-10-29T09:00:00Z'), at('2026-10-29T09:00:00Z'));
    noteServerDate(null, 0, 0);
    noteServerDate('soon', 0, 0);
    expect(serverNow().toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it('is what the screens read as now', async () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    noteServerDate('Thu, 29 Oct 2026 12:00:00 GMT', at('2026-10-29T09:00:00Z'), at('2026-10-29T09:00:00Z'));
    let seen: Date | null = null;
    function Clock() {
      seen = useNow(60_000);
      return null;
    }
    await act(async () => {
      create(<Clock />);
    });
    expect(seen!.toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it("ignores an answer that took long, which can't say when it was sent", () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    noteServerDate('Thu, 29 Oct 2026 12:00:00 GMT', at('2026-10-29T08:59:50Z'), at('2026-10-29T09:00:00Z'));
    expect(serverNow().toISOString()).toBe('2026-10-29T09:00:00.000Z');
  });

  it('moves a screen opened before the first answer to the server time once it comes', async () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    let seen: Date | null = null;
    function Clock() {
      seen = useNow(60_000);
      return null;
    }
    await act(async () => {
      create(<Clock />);
    });
    expect(seen!.toISOString()).toBe('2026-10-29T09:00:00.000Z');
    await act(async () => {
      noteServerDate('Thu, 29 Oct 2026 12:00:00 GMT', at('2026-10-29T09:00:00Z'), at('2026-10-29T09:00:00Z'));
    });
    expect(seen!.toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it("ignores an answer that came back to a clock set back meanwhile, which can't say when it was sent", () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    noteServerDate('Thu, 29 Oct 2026 09:00:00 GMT', at('2026-10-29T12:00:00Z'), at('2026-10-29T09:00:00Z'));
    expect(serverNow().toISOString()).toBe('2026-10-29T09:00:00.000Z');
  });

  describe('a phone that hears many answers', () => {
    /** Answers from a server this far ahead of the phone, a little apart, each cut to the second. */
    function hearAnswers(serverAhead: number, count: number) {
      const changes = jest.fn();
      const stop = onServerClockChange(changes);
      for (let answer = 0; answer < count; answer += 1) {
        jest.advanceTimersByTime(137);
        const receivedAt = Date.now();
        noteServerDate(new Date(receivedAt - 50 + serverAhead).toUTCString(), receivedAt - 100, receivedAt);
      }
      stop();
      return changes.mock.calls.length;
    }

    it('settles once at the edge of a minute off, where the cut second lands on either side', () => {
      jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
      expect(hearAnswers(60_300, 40)).toBeLessThanOrEqual(1);
    });

    it('stays put over answers that only differ by the cut second', () => {
      jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
      expect(hearAnswers(3 * 60 * 60_000, 10)).toBe(1);
    });

    it('moves again when the phone has really moved by a minute', () => {
      jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
      expect(hearAnswers(3 * 60 * 60_000, 3)).toBe(1);
      expect(hearAnswers(2 * 60 * 60_000, 3)).toBe(1);
      expect(Math.abs(serverNow().getTime() - Date.now() - 2 * 60 * 60_000)).toBeLessThan(1000);
    });

    it('goes back to the phone once the phone is right', () => {
      jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
      hearAnswers(3 * 60 * 60_000, 3);
      expect(hearAnswers(0, 3)).toBe(1);
      expect(serverNow().getTime()).toBe(Date.now());
    });
  });

  it("leaves a timer on the phone's own clock, as its times were written by it", async () => {
    jest.useFakeTimers({ now: at('2026-10-29T09:00:00Z') });
    noteServerDate('Thu, 29 Oct 2026 12:00:00 GMT', at('2026-10-29T09:00:00Z'), at('2026-10-29T09:00:00Z'));
    let seen: Date | null = null;
    function Timer() {
      seen = useNow(1000, 'phone');
      return null;
    }
    await act(async () => {
      create(<Timer />);
    });
    expect(seen!.toISOString()).toBe('2026-10-29T09:00:00.000Z');
  });

  describe("what was read before the phone's clock moved", () => {
    const HOUR = 60 * 60_000;
    /** Past the second the persister can hold a save back. */
    const SAVE_MS = 1500;
    const machineNow = Date.now.bind(Date);
    let phoneAhead = 0;
    let app: ReactTestRenderer | undefined;

    const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
    const hearServer = () => noteServerDate(new Date(machineNow()).toUTCString(), Date.now(), Date.now());

    function Reader({ read }: { read: () => Promise<string> }) {
      useQuery({ queryKey: ['packs'], queryFn: read });
      return null;
    }

    /** The root of the app, always there, and a screen with one read when it is given one. */
    function Root({ read }: { read?: () => Promise<string> }) {
      useRefetchWhenClockMoves();
      return read ? <Reader read={read} /> : null;
    }

    function App({ client, read }: { client: QueryClient; read?: () => Promise<string> }) {
      return (
        <QueryClientProvider client={client}>
          <Root read={read} />
        </QueryClientProvider>
      );
    }

    async function open(client: QueryClient, read: () => Promise<string>) {
      await act(async () => {
        app = create(<App client={client} read={read} />);
      });
      await settle();
    }

    /** A start of the app on the copy kept on the phone. */
    async function openOnCopy(read: () => Promise<string>) {
      await act(async () => {
        app = create(
          <PersistQueryClientProvider client={newClient()} persistOptions={persistOptions}>
            <Root read={read} />
          </PersistQueryClientProvider>,
        );
      });
      await settle();
    }

    const newClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });

    beforeEach(() => {
      jest.spyOn(Date, 'now').mockImplementation(() => machineNow() + phoneAhead);
    });

    afterEach(async () => {
      await act(async () => app?.unmount());
      app = undefined;
      phoneAhead = 0;
      jest.restoreAllMocks();
    });

    it('looks fresh after the clock is set right, and is read again once an answer shows that', async () => {
      const read = jest.fn(async () => 'from the server');
      phoneAhead = 3 * HOUR;
      hearServer();
      await open(newClient(), read);
      expect(read).toHaveBeenCalledTimes(1);

      phoneAhead = 0;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await settle();
      expect(read).toHaveBeenCalledTimes(1);

      await act(async () => hearServer());
      await settle();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('is read again when a screen next asks for it, if no screen shows it now', async () => {
      const read = jest.fn(async () => 'from the server');
      const client = newClient();
      phoneAhead = 3 * HOUR;
      hearServer();
      await open(client, read);

      await act(async () => app?.update(<App client={client} />));
      phoneAhead = 0;
      await act(async () => hearServer());
      await settle();
      expect(read).toHaveBeenCalledTimes(1);

      await act(async () => app?.update(<App client={client} read={read} />));
      await settle();
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('is read again from the copy kept on the phone, when the app heard of no move', async () => {
      const read = jest.fn(async () => 'from the server');
      phoneAhead = 3 * HOUR;
      hearServer();
      await openOnCopy(read);
      await act(() => new Promise((resolve) => setTimeout(resolve, SAVE_MS)));
      await act(async () => app?.unmount());
      expect(read).toHaveBeenCalledTimes(1);

      // Android's widget refresh runs with no app open, and it learns of the move first.
      phoneAhead = 0;
      hearServer();

      await openOnCopy(read);
      expect(read).toHaveBeenCalledTimes(2);
    });

    it('stays as it is over answers that show no move', async () => {
      const read = jest.fn(async () => 'from the server');
      phoneAhead = 3 * HOUR;
      hearServer();
      await open(newClient(), read);

      for (let answer = 0; answer < 5; answer += 1) {
        await act(async () => hearServer());
        await settle();
      }
      expect(read).toHaveBeenCalledTimes(1);
    });

    it("doesn't go round when the read that follows is itself an answer", async () => {
      const read = jest.fn(async () => {
        hearServer();
        return 'from the server';
      });
      phoneAhead = 3 * HOUR;
      await open(newClient(), read);
      await settle();
      expect(read.mock.calls.length).toBeLessThanOrEqual(2);
      const reads = read.mock.calls.length;

      await settle();
      expect(read).toHaveBeenCalledTimes(reads);
    });
  });
});

describe('how long a request waits for its answer', () => {
  const READ = 'http://gozali.test/rest/v1/packs';
  const PHOTO = 'http://gozali.test/storage/v1/object/feed-photos/pack/noa/a.jpg';
  const FUNCTION = 'http://gozali.test/functions/v1/delete-account';
  const realFetch = globalThis.fetch;

  /** Ends only when it is aborted, as a request on a dead connection does. */
  const noAnswer = (_input: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });

  async function secondsUntilItGivesUp(input: string, init?: RequestInit): Promise<number | null> {
    const started = Date.now();
    let gaveUp: number | null = null;
    void clockedFetch(input, init).catch(() => {
      gaveUp = (Date.now() - started) / 1000;
    });
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    return gaveUp;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    globalThis.fetch = noAnswer as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = realFetch;
  });

  it('is half a minute for a read or a write', async () => {
    expect(await secondsUntilItGivesUp(READ)).toBe(30);
    expect(await secondsUntilItGivesUp(`${READ}/rpc/submit_feed`, { method: 'POST', body: '{}' })).toBe(30);
  });

  it('is longer for a photo going up, as its answer comes after the whole photo', async () => {
    expect(await secondsUntilItGivesUp(PHOTO, { method: 'POST', body: new ArrayBuffer(8) })).toBe(160);
  });

  it('is longer than a function can run, so a function that is still working keeps its answer', async () => {
    expect(await secondsUntilItGivesUp(FUNCTION, { method: 'POST', body: '{}' })).toBe(160);
  });

  it('still ends when the caller aborts', async () => {
    const caller = new AbortController();
    const failed = jest.fn();
    void clockedFetch(READ, { signal: caller.signal }).catch(failed);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(failed).not.toHaveBeenCalled();

    caller.abort();
    await jest.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('ends at once for a caller who aborted before it started', async () => {
    const caller = new AbortController();
    caller.abort();
    expect(await secondsUntilItGivesUp(READ, { signal: caller.signal })).toBe(0);
  });

  describe('once the answer has started', () => {
    let signal: AbortSignal | null | undefined;

    beforeEach(() => {
      signal = undefined;
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return new Response('[]', { headers: { date: new Date().toUTCString() } });
      }) as unknown as typeof fetch;
    });

    it('stops counting, as a body cut off halfway would read as a good answer with no data', async () => {
      const before = jest.getTimerCount();
      await clockedFetch(READ);
      expect(signal).toBeDefined();
      expect(jest.getTimerCount()).toBe(before);

      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(signal?.aborted).toBe(false);
    });

    it('still lets the caller end the body', async () => {
      const caller = new AbortController();
      await clockedFetch(READ, { signal: caller.signal });
      caller.abort();
      expect(signal?.aborted).toBe(true);
    });
  });
});
