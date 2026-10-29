import { useEffect, useState } from 'react';

import { serverNow } from '@/lib/serverClock';

/** The current time by the server's clock (lib/serverClock), refreshed every `intervalMs`. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
