// Runs every minute from pg_cron. Claims the notifications that are due (the database applies
// quiet hours, preferences and the daily cap), sends them through Expo Push, and requeues what
// the push service didn't take.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { hasCronSecret } from '../_shared/secret.ts';
import type { ClaimedRow } from './messages.ts';
import { EXPO_PUSH_URL, RefusedRequest, runFailed, sendAll, type PushMessage, type PushTicket } from './push.ts';

// A worker's 150 seconds are shared by every request it serves, so a run may have only 75 of them
// left. A request to Expo that hangs is given up after 20, and no new one starts after 50, which
// leaves time to put back what wasn't sent.
export const REQUEST_TIMEOUT_MS = 20_000;
export const SEND_BUDGET_MS = 50_000;
// HEARTBEAT_URL, when set, is an outside check that mails the owner when its pings stop. A wrong
// secret, a missing Vault value or Expo turning everything down fails the run or keeps it from
// starting, and the owners' alerts go out through this function too, so only a run that went well
// pings it. A run past its budget leaves it to the next one.
export const HEARTBEAT_TIMEOUT_MS = 5_000;

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
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const message = `expo push ${response.status}`;
    // A 4xx is about what the request carries, unless it is the access token or the rate limit.
    if (response.status < 500 && ![401, 403, 429].includes(response.status)) throw new RefusedRequest(message);
    throw new Error(message);
  }
  const { data } = (await response.json()) as { data?: PushTicket[] };
  if (!Array.isArray(data)) throw new Error(`expo push ${response.status} without tickets`);
  return data;
}

/** The ping carries nothing, and a check that is down or slow changes nothing about the run. */
async function pingHeartbeat(): Promise<void> {
  const target = Deno.env.get('HEARTBEAT_URL');
  if (!target) return;
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS) });
    await response.body?.cancel();
  } catch (error) {
    console.error('heartbeat failed', error instanceof Error ? error.message : String(error));
  }
}

Deno.serve(async (request) => {
  if (!hasCronSecret(request)) return new Response('forbidden', { status: 403 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const claimed = await client.rpc('claim_notifications', { at_time: new Date().toISOString() });
  if (claimed.error) return Response.json({ error: claimed.error.message }, { status: 500 });

  const rows = claimed.data as ClaimedRow[];
  const started = Date.now();
  const result = await sendAll(rows, expoSend, () => Date.now() - started > SEND_BUDGET_MS);
  let requeued = result.requeue.length > 0 ? await client.rpc('requeue_notifications', { ids: result.requeue, refused: result.refused }) : null;
  // A server behind this function takes the rows back without the list, each spending a try. The
  // run still answers 502, so the missing migration gets noticed.
  const serverBehind = requeued?.error?.code === 'PGRST202';
  if (serverBehind) {
    console.error('requeue_notifications has no refused argument on this server', requeued?.error?.message);
    requeued = await client.rpc('requeue_notifications', { ids: result.requeue });
  }
  // These rows stay marked as sent with nothing delivered, so the log is what is left of them.
  if (requeued?.error) console.error('requeue failed', requeued.error.message, result.requeue.join(' '));
  if (result.deadTokens.length > 0) {
    const forgotten = await client.rpc('forget_push_tokens', { dead: result.deadTokens });
    if (forgotten.error) console.error('forgetting dead tokens failed', forgotten.error.message);
  }
  const report = {
    claimed: rows.length,
    attempted: result.attempted,
    sent: result.sent,
    requeued: requeued?.error ? 0 : result.requeue.length,
    ticketErrors: result.ticketErrors,
    failure: result.failure,
  };
  // Any answer but 200 reaches the owners' daily summary, through collect_service_errors.
  const failed = serverBehind || Boolean(requeued?.error) || runFailed(result);
  if (failed) console.error('send-push failed', report);
  else if (Date.now() - started <= SEND_BUDGET_MS) await pingHeartbeat();
  return Response.json(report, { status: failed ? 502 : 200 });
});
