// Runs every 15 minutes from pg_cron (see the scheduling migration). The caller must send the
// shared secret in x-cron-secret; the function itself uses the service role.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { hasCronSecret } from '../_shared/secret.ts';
import { cleanupPhotos, closeDueDays, dropEmptyPacks } from './close.ts';

const REMOVE_BATCH = 100;

Deno.serve(async (request) => {
  if (!hasCronSecret(request)) return new Response('forbidden', { status: 403 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const now = new Date();
  // First, so a long gap since the last run is recorded as an outage before its days close.
  const heartbeat = await client.rpc('note_heartbeat', { job_name: 'close-days', at_time: now.toISOString() });
  if (heartbeat.error) console.error('close-days heartbeat', heartbeat.error.message);
  const { closed, failed } = await closeDueDays(client, now);
  const removeFiles = async (paths: string[]) => {
    for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
      const { error } = await client.storage.from('feed-photos').remove(paths.slice(start, start + REMOVE_BATCH));
      if (error) throw error;
    }
  };
  const photos = await cleanupPhotos(client, removeFiles, now);
  const packs = await dropEmptyPacks(client, removeFiles, now);
  if (failed.length > 0) console.error('close-days failures', JSON.stringify(failed));
  return Response.json(
    { closed: closed.length, failed: failed.length, outage: heartbeat.data === true, photos, droppedPacks: packs },
    { status: failed.length ? 500 : 200 },
  );
});
