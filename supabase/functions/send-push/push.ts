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
 * Sends every message. A batch the service rejects puts its notifications back in the queue;
 * tokens Expo reports as no longer registered are returned so they can be forgotten.
 */
export async function sendAll(
  rows: readonly ClaimedRow[],
  send: (batch: PushMessage[]) => Promise<PushTicket[]>,
): Promise<{ sent: number; requeue: string[]; deadTokens: string[] }> {
  const messages = toMessages(rows);
  const requeue = new Set<string>();
  const deadTokens: string[] = [];
  let sent = 0;
  for (let start = 0; start < messages.length; start += BATCH) {
    const batch = messages.slice(start, start + BATCH);
    try {
      const tickets = await send(batch);
      tickets.forEach((ticket, index) => {
        const message = batch[index];
        if (!message) return;
        if (ticket.status === 'ok') sent += 1;
        else if (ticket.details?.error === 'DeviceNotRegistered') deadTokens.push(message.to);
      });
    } catch {
      for (const message of batch) requeue.add(message.data.notificationId);
    }
  }
  return { sent, requeue: [...requeue], deadTokens };
}
