// Runs every 15 minutes from pg_cron (see the scheduling migration). The caller must send the
// shared secret in x-cron-secret; the function itself uses the service role.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { hasCronSecret } from '../_shared/secret.ts';
import { closeAfterHeartbeat, runCleanups } from './close.ts';

const REMOVE_BATCH = 100;

Deno.serve(async (request) => {
  if (!hasCronSecret(request)) return new Response('forbidden', { status: 403 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const now = new Date();
  let days: Awaited<ReturnType<typeof closeAfterHeartbeat>>;
  try {
    days = await closeAfterHeartbeat(client, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('close-days', message);
    return Response.json({ error: message }, { status: 500 });
  }
  const { outage, closed, failed, deferred } = days;
  // Before the cleanups: a worker can run out of time in them and this line would go with it.
  if (failed.length > 0) console.error('close-days failures', JSON.stringify(failed));
  const remover = (bucket: string) => async (paths: string[]) => {
    for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
      const { error } = await client.storage.from(bucket).remove(paths.slice(start, start + REMOVE_BATCH));
      if (error) throw error;
    }
  };
  const cleanups = await runCleanups(client, remover, now);
  if (cleanups.failed.length > 0) console.error('close-days cleanups', JSON.stringify(cleanups.failed));
  // Any answer but 200 reaches the owners' daily summary, through collect_service_errors.
  return Response.json(
    {
      closed: closed.length,
      failed: failed.length,
      deferred,
      outage,
      photos: cleanups.photos,
      droppedPacks: cleanups.droppedPacks,
      failedCleanups: cleanups.failed.map((row) => row.step),
    },
    { status: failed.length + cleanups.failed.length > 0 ? 500 : 200 },
  );
});
