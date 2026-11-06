-- The owners' summary goes out at 21:00, and the next one looks at the next calendar day, which left
-- the evening in neither. What went wrong now counts from one 21:00 on the owner's clock to the next:
-- reports, app errors, failed calls, failed jobs and down hours land in exactly one summary, also on a
-- day the clocks change and when the summary is made late. Sign-ups and feeds stay the day so far.
-- Failed calls reach service_errors every five minutes, on the same tick as this job, so they are
-- collected first: a call just before 21:00 belongs to this summary and the next starts after it.
create or replace function public.queue_daily_summaries(at_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  perform public.collect_service_errors();
  insert into public.notifications (user_id, type, day, payload)
  select o.user_id, 'daily_summary', d.local_date, jsonb_build_object(
    'newUsers', (select count(*) from public.profiles p where p.terms_accepted_at >= d.starts and p.terms_accepted_at < d.ends),
    'users', (select count(*) from public.profiles p where p.terms_accepted_at is not null),
    'feeders', (
      select count(distinct f.user_id) from public.feeds f
      where not f.is_extra and f.created_at >= d.starts and f.created_at < d.ends
    ),
    'packs', (
      select count(distinct f.pack_id) from public.feeds f
      where not f.is_extra and f.created_at >= d.starts and f.created_at < d.ends
    ),
    'reports', (select count(*) from public.reports r where r.created_at >= d.last_summary and r.created_at < d.this_summary),
    'errors', (select count(*) from public.app_errors e where e.created_at >= d.last_summary and e.created_at < d.this_summary),
    'serverErrors', (select count(*) from public.service_errors s where s.at >= d.last_summary and s.at < d.this_summary),
    'failedJobs', (
      select count(*) from cron.job_run_details j
      where j.status = 'failed' and j.start_time >= d.last_summary and j.start_time < d.this_summary
    ),
    'downHours', (
      select coalesce(round(sum(extract(epoch from least(x.ends_at, d.this_summary) - greatest(x.starts_at, d.last_summary))) / 3600), 0)
      from public.outages x
      where x.starts_at < d.this_summary and x.ends_at > d.last_summary
    ),
    'packsBehind', (select count(*) from public.packs_to_close(at_time - interval '1 hour')),
    'fileMB', (select coalesce(round(sum((f.metadata ->> 'size')::numeric) / 1e6), 0) from storage.objects f),
    'backupDays', (select round(extract(epoch from at_time - h.at) / 86400)::int from public.heartbeats h where h.job = 'backup')
  )
  from public.app_owners o
  join public.profiles pr on pr.id = o.user_id
  cross join lateral (select at_time at time zone pr.timezone as local_now) l
  cross join lateral (
    select
      l.local_now::date as local_date,
      l.local_now::date::timestamp at time zone pr.timezone as starts,
      (l.local_now::date + 1)::timestamp at time zone pr.timezone as ends,
      (l.local_now::date - 1 + time '21:00') at time zone pr.timezone as last_summary,
      (l.local_now::date + time '21:00') at time zone pr.timezone as this_summary
  ) d
  where l.local_now::time >= '21:00' and l.local_now::time < '23:00'
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
