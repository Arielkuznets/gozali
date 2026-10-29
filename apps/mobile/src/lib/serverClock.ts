// The server decides which day a feed counts for, so "today" on screen follows the server's clock:
// a phone set hours off would otherwise show the wrong countdown and "fed today". The offset comes
// from the Date header of the app's own requests. Under a minute off is left alone, as noise.
const IGNORED_MS = 60_000;

let offsetMs = 0;

/** Learns the server's time from a response's Date header, sent and received at the given times. */
export function noteServerDate(dateHeader: string | null, sentAt: number, receivedAt: number): void {
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  if (Number.isNaN(server)) return;
  const offset = server - (sentAt + receivedAt) / 2;
  offsetMs = Math.abs(offset) < IGNORED_MS ? 0 : offset;
}

/** Now, by the server's clock as far as this phone knows it. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** A fetch that notes the server's time from every answer. */
export const clockedFetch: typeof fetch = async (input, init) => {
  const sentAt = Date.now();
  const response = await fetch(input, init);
  noteServerDate(response.headers.get('date'), sentAt, Date.now());
  return response;
};
