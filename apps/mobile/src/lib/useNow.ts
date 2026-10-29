import { useEffect, useState } from 'react';

import { onServerClockChange, serverNow } from '@/lib/serverClock';

/**
 * The current time, refreshed every `intervalMs`: by the server's clock (lib/serverClock), or by
 * the phone's for timers whose own times the phone wrote (the focus session).
 */
export function useNow(intervalMs: number, clock: 'server' | 'phone' = 'server'): Date {
  const read = clock === 'server' ? serverNow : () => new Date();
  const [now, setNow] = useState(read);
  useEffect(() => {
    const tick = () => setNow(clock === 'server' ? serverNow() : new Date());
    const timer = setInterval(tick, intervalMs);
    // A screen opened before the first answer moves to the server's time as soon as it is known.
    const stop = clock === 'server' ? onServerClockChange(tick) : () => undefined;
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [intervalMs, clock]);
  return now;
}
