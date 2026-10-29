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
 * Sends every message. A batch the service refuses is sent again one notification at a time,
 * and the notifications it still refuses go back in the queue, like a batch it fails to take
 * while down; tokens Expo reports as no longer registered are returned so they can be forgotten.
 */
export async function sendAll(
  rows: readonly ClaimedRow[],
  send: (batch: PushMessage[]) => Promise<PushTicket[]>,
): Promise<{ sent: number; requeue: string[]; deadTokens: string[] }> {
  const messages = toMessages(rows);
  const requeue = new Set<string>();
  const deadTokens: string[] = [];
  let sent = 0;
  const deliver = async (batch: PushMessage[]): Promise<'sent' | 'refused' | 'failed'> => {
    try {
      const tickets = await send(batch);
      tickets.forEach((ticket, index) => {
        const message = batch[index];
        if (!message) return;
        if (ticket.status === 'ok') sent += 1;
        else if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(message.to);
      });
      return 'sent';
    } catch (error) {
      return error instanceof RefusedRequest ? 'refused' : 'failed';
    }
  };
  for (let start = 0; start < messages.length; start += BATCH) {
    const batch = messages.slice(start, start + BATCH);
    const outcome = await deliver(batch);
    if (outcome === 'sent') continue;
    const ids = new Set(batch.map((message) => message.data.notificationId));
    // Expo turns down a whole request for one bad message (a token of another Expo project is
    // enough), and the same batch would fail again on every run, holding up everyone in it. A
    // service that is down or busy gets no more requests: the run has to requeue before it ends.
    for (const id of ids) {
      const alone = outcome === 'refused' && ids.size > 1;
      if (!alone || (await deliver(batch.filter((message) => message.data.notificationId === id))) !== 'sent') requeue.add(id);
    }
  }
  return { sent, requeue: [...requeue], deadTokens };
}
