import { act, create } from 'react-test-renderer';

import { noteServerDate, serverNow } from '@/lib/serverClock';
import { useNow } from '@/lib/useNow';

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
});
