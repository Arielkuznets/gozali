// Runs every minute from pg_cron. Claims the notifications that are due (the database applies
// quiet hours, preferences and the daily cap), sends them through Expo Push, and requeues what
// the push service didn't take.
import { createClient } from 'npm:@supabase/supabase-js@2';

import type { ClaimedRow } from './messages.ts';
import { EXPO_PUSH_URL, sendAll, type PushMessage, type PushTicket } from './push.ts';

async function expoSend(batch: PushMessage[]): Promise<PushTicket[]> {
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(batch),
  });
  if (!response.ok) throw new Error(`expo push ${response.status}`);
  const { data } = (await response.json()) as { data: PushTicket[] };
  return data;
}

Deno.serve(async (request) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const claimed = await client.rpc('claim_notifications', { at_time: new Date().toISOString() });
  if (claimed.error) return Response.json({ error: claimed.error.message }, { status: 500 });

  const rows = claimed.data as ClaimedRow[];
  const result = await sendAll(rows, expoSend);
  if (result.requeue.length > 0) await client.rpc('requeue_notifications', { ids: result.requeue });
  if (result.deadTokens.length > 0) await client.rpc('forget_push_tokens', { dead: result.deadTokens });
  return Response.json({ claimed: rows.length, sent: result.sent, requeued: result.requeue.length });
});
