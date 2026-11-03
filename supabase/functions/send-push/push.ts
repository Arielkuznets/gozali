// Turns claimed notifications into Expo push messages and sends them in batches. Plain
// TypeScript, run by Deno in the Edge Function and by Node in the tests.
import { render, type ClaimedRow } from './messages.ts';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string; notificationId: string };
  sound: 'default';
  channelId: 'default';
}

/** Expo's answer per message, in the same order. */
export interface PushTicket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

/** The push service turned a request down for what is in it, not because it is down or busy. */
export class RefusedRequest extends Error {}

export interface SendResult {
  /** Messages the service was offered, each counted once. */
  attempted: number;
  sent: number;
  requeue: string[];
  /** The part of `requeue` the service turned down; the rest was never answered and costs no try. */
  refused: string[];
  deadTokens: string[];
  /**
   * Messages Expo answered with an error, by its code, leaving out tokens that are gone. Notifications
   * it wouldn't take are in here too, as RefusedRequest, so they read the same whatever else the run sent.
   */
  ticketErrors: Record<string, number>;
  /**
   * What the request that ended the sending failed with, or else what the first refused one got. A run
   * whose requests all got an answer has none.
   */
  failure?: string;
}

export function toMessages(rows: readonly ClaimedRow[]): PushMessage[] {
  return rows.flatMap((row) => {
    const text = render(row);
    return row.tokens.map((to) => ({
      to,
      title: text.title,
      body: text.body,
      data: { url: text.url, notificationId: row.id },
      sound: 'default' as const,
      channelId: 'default' as const,
    }));
  });
}

/**
 * Sends every message. A batch the service refuses is sent again one notification at a time, and
 * the notifications it still refuses go back in the queue, named in `refused`; tokens Expo reports
 * as no longer registered are returned so they can be forgotten. After a request that fails, or
 * once `outOfTime` says so, what is left isn't sent but goes back in the queue: the claimed rows
 * already count as sent, and a run cut off by the function's time limit would lose them.
 */
export async function sendAll(
  rows: readonly ClaimedRow[],
  send: (batch: PushMessage[]) => Promise<PushTicket[]>,
  outOfTime: () => boolean = () => false,
): Promise<SendResult> {
  const messages = toMessages(rows);
  const requeue = new Set<string>();
  const refused = new Set<string>();
  const deadTokens: string[] = [];
  const ticketErrors: Record<string, number> = {};
  let attempted = 0;
  let sent = 0;
  let down = false;
  let failure: string | undefined;
  const deliver = async (batch: PushMessage[]): Promise<'sent' | 'refused' | 'failed'> => {
    try {
      const tickets = await send(batch);
      tickets.forEach((ticket, index) => {
        const message = batch[index];
        if (!message) return;
        if (ticket.status === 'ok') sent += 1;
        else if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(message.to);
        else {
          const code = ticket.details?.error ?? 'unknown';
          ticketErrors[code] = (ticketErrors[code] ?? 0) + 1;
        }
      });
      return 'sent';
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof RefusedRequest) {
        failure ??= reason;
        return 'refused';
      }
      failure = reason;
      down = true;
      return 'failed';
    }
  };
  const stopped = () => down || outOfTime();
  for (let start = 0; start < messages.length; start += BATCH) {
    const batch = messages.slice(start, start + BATCH);
    const ids = new Set(batch.map((message) => message.data.notificationId));
    if (stopped()) {
      for (const id of ids) requeue.add(id);
      continue;
    }
    attempted += batch.length;
    const outcome = await deliver(batch);
    if (outcome === 'sent') continue;
    // Expo turns down a whole request for one bad message (a token of another Expo project is
    // enough), and the same batch would fail again on every run, holding up everyone in it. A
    // service that is down or busy gets no more requests: the run has to requeue before it ends.
    for (const id of ids) {
      const alone = outcome === 'refused' && ids.size > 1 && !stopped();
      const answer = alone ? await deliver(batch.filter((message) => message.data.notificationId === id)) : outcome;
      if (answer !== 'sent') requeue.add(id);
      // A batch turned down as a whole says nothing about a row unless the row is all there is.
      if (answer === 'refused' && (alone || ids.size === 1)) refused.add(id);
    }
  }
  if (refused.size > 0) ticketErrors.RefusedRequest = refused.size;
  return { attempted, sent, requeue: [...requeue], refused: [...refused], deadTokens, ticketErrors, failure };
}

/**
 * Whether the service answered a message with an error or took none of what it was offered. A
 * token it reports as gone is an answer from a working service, so a run that found only those
 * didn't fail.
 */
export function runFailed(result: SendResult): boolean {
  if (Object.keys(result.ticketErrors).length > 0) return true;
  return result.sent === 0 && result.attempted > result.deadTokens.length;
}
