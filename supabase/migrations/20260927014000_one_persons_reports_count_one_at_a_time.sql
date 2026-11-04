-- One person's reports are counted toward their 20 emails a day one request at a time. Requests sent
-- at the same moment each counted only the reports already saved, so all of them passed the cap. A
-- lock on the reporter, held to the end of the request, makes each wait for the ones before it, so
-- its count sees their reports; one lock a request, however many reports it holds.
create or replace function public.handle_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid boolean := false;
begin
  if (select count(*) from public.reports r where r.feed_id = new.feed_id and r.handled_at is null) >= 3 then
    update public.feeds set hidden_at = now() where id = new.feed_id and hidden_at is null;
    hid := found;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('report_emails:' || new.reporter_id::text, 0));
  if hid or (select count(*) from public.reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') <= 20 then
    perform public.call_edge_function('on-report', jsonb_build_object('reportId', new.id));
  end if;
  return new;
end;
$$;
