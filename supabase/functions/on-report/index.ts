// Emails the developer about every report (spec section 11: handled within 24 hours). Called by
// the report trigger through pg_net with the shared secret. Sends through Resend when
// RESEND_API_KEY and REPORT_EMAIL are set; otherwise the report only goes to the function log.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { hasCronSecret } from '../_shared/secret.ts';
const PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

type Details = {
  reportId: string;
  reason: string | null;
  reportedAt: string;
  reporter: { id: string; name: string | null };
  author: { id: string; name: string | null };
  feed: { id: string; caption: string | null; photoPath: string | null; hidden: boolean; postedAt: string; packId: string };
  reports: number;
};

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

Deno.serve(async (request) => {
  if (!hasCronSecret(request)) return new Response('forbidden', { status: 403 });
  const { reportId } = (await request.json()) as { reportId?: string };
  if (!reportId) return new Response('missing report', { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('report_details', { report: reportId });
  if (error || !data) return Response.json({ error: error?.message ?? 'not found' }, { status: 404 });
  const details = data as Details;

  let photo = '';
  if (details.feed.photoPath) {
    const signed = await admin.storage.from('feed-photos').createSignedUrl(details.feed.photoPath, PHOTO_LINK_SECONDS);
    photo = signed.data?.signedUrl ?? '';
  }

  const lines = [
    `Report ${details.reportId} (${details.reports} on this item${details.feed.hidden ? ', now hidden' : ''})`,
    `Reason: ${details.reason ?? '(none given)'}`,
    `Reported by: ${details.reporter.name ?? '?'} (${details.reporter.id})`,
    `Posted by: ${details.author.name ?? '?'} (${details.author.id}) at ${details.feed.postedAt}`,
    `Caption: ${details.feed.caption ?? '(none)'}`,
    `Photo (link valid 7 days): ${photo || '(no photo)'}`,
    '',
    `Hide: update public.feeds set hidden_at = now() where id = '${details.feed.id}';`,
    `Remove the member: delete their account from the Auth dashboard (${details.author.id}).`,
  ];

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('REPORT_EMAIL');
  if (!apiKey || !to) {
    console.log('report (no email configured)', lines.join('\n'));
    return Response.json({ emailed: false });
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('REPORT_EMAIL_FROM') ?? 'Gozali <onboarding@resend.dev>',
      to: [to],
      subject: `Gozali report: ${details.feed.caption ?? 'a photo'} (${details.reports})`,
      text: lines.join('\n'),
      html: `<pre style="font-family:system-ui">${escape(lines.join('\n'))}</pre>${photo ? `<img src="${photo}" width="360">` : ''}`,
    }),
  });
  if (response.ok) return Response.json({ emailed: true });
  // Resend says why it refused (a wrong key, or a sender it doesn't allow for that address); the
  // answer lands in the function log and in net._http_response, where the trigger's call is kept.
  const reason = await response.text();
  console.error('report email failed', response.status, reason);
  return Response.json({ emailed: false, status: response.status, reason }, { status: 502 });
});
