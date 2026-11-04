// Emails the developer about a report (spec section 11: handled within 24 hours). Called by the
// report trigger through pg_net with the shared secret, for up to 20 reports a day from one person
// and for the report that hides a photo.
// Sends through Resend with RESEND_API_KEY to REPORT_EMAIL. Only a sent email answers 200: any other
// answer counts as a server error in the owners' daily summary, and names the report, which nothing
// sends again, so the owner can find it in the database.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { hasCronSecret } from '../_shared/secret.ts';
import { reportEmail, reportedPicture, type Details } from './email.ts';

const PHOTO_LINK_SECONDS = 7 * 24 * 60 * 60;

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

Deno.serve(async (request) => {
  // Read before the secret is checked, so that a call refused for a wrong secret names its report too.
  const { reportId } = ((await request.json().catch(() => null)) ?? {}) as { reportId?: string };
  if (!hasCronSecret(request)) return Response.json({ reportId, error: 'forbidden' }, { status: 403 });
  if (!reportId) return new Response('missing report', { status: 400 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin.rpc('report_details', { report: reportId });
  if (error || !data) return Response.json({ reportId, error: error?.message ?? 'not found' }, { status: 404 });
  const details = data as Details;

  const picture = reportedPicture(details);
  let photo = '';
  if (picture) {
    const signed = await admin.storage.from(picture.bucket).createSignedUrl(picture.path, PHOTO_LINK_SECONDS);
    photo = signed.data?.signedUrl ?? '';
  }

  const { subject, lines } = reportEmail(details, photo);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('REPORT_EMAIL');
  if (!apiKey || !to) {
    console.error('report not emailed: RESEND_API_KEY or REPORT_EMAIL is not set', lines.join('\n'));
    return Response.json({ reportId, emailed: false, reason: 'RESEND_API_KEY or REPORT_EMAIL is not set' }, { status: 503 });
  }
  let response: Response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('REPORT_EMAIL_FROM') ?? 'Gozali <onboarding@resend.dev>',
        to: [to],
        subject,
        text: lines.join('\n'),
        html: `<pre style="font-family:system-ui">${escape(lines.join('\n'))}</pre>${photo ? `<img src="${photo}" width="360">` : ''}`,
      }),
    });
  } catch (failure) {
    console.error('report email failed', reportId, failure);
    return Response.json({ reportId, emailed: false, reason: String(failure) }, { status: 502 });
  }
  if (response.ok) return Response.json({ reportId, emailed: true });
  // Resend says why it refused (a wrong key, or a sender it doesn't allow for that address); the
  // answer lands in the function log and in net._http_response, where the trigger's call is kept.
  const reason = await response.text();
  console.error('report email failed', reportId, response.status, reason);
  return Response.json({ reportId, emailed: false, status: response.status, reason }, { status: 502 });
});
