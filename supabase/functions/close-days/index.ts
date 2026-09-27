// Runs every 15 minutes from pg_cron (see the scheduling migration). The caller must send the
// shared secret in x-cron-secret; the function itself uses the service role.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { cleanupPhotos, closeDueDays } from './close.ts';

Deno.serve(async (request) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const now = new Date();
  const { closed, failed } = await closeDueDays(client, now);
  const photos = await cleanupPhotos(
    client,
    async (paths) => {
      const { error } = await client.storage.from('feed-photos').remove(paths);
      if (error) throw error;
    },
    now,
  );
  if (failed.length > 0) console.error('close-days failures', JSON.stringify(failed));
  return Response.json({ closed: closed.length, failed: failed.length, photos }, { status: failed.length ? 500 : 200 });
});
