-- Supabase writes to the billing address only once a quota is passed, so the owners' daily summary
-- carries the size of the stored files, to warn ahead of it. The quota counts every bucket. Storage
-- keeps each file's size in its row, and a row without one adds nothing.
create or replace function public.queue_daily_summaries(at_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
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
    'reports', (select count(*) from public.reports r where r.created_at >= d.starts and r.created_at < d.ends),
    'errors', (select count(*) from public.app_errors e where e.created_at >= d.starts and e.created_at < d.ends),
    'serverErrors', (select count(*) from public.service_errors s where s.at >= d.starts and s.at < d.ends),
    'failedJobs', (
      select count(*) from cron.job_run_details j
      where j.status = 'failed' and j.start_time >= d.starts and j.start_time < d.ends
    ),
    'downHours', (
      select coalesce(round(sum(extract(epoch from least(x.ends_at, d.ends) - greatest(x.starts_at, d.starts))) / 3600), 0)
      from public.outages x
      where x.starts_at < d.ends and x.ends_at > d.starts
    ),
    'packsBehind', (select count(*) from public.packs_to_close(at_time - interval '1 hour')),
    'fileMB', (select coalesce(round(sum((f.metadata ->> 'size')::numeric) / 1e6), 0) from storage.objects f)
  )
  from public.app_owners o
  join public.profiles pr on pr.id = o.user_id
  cross join lateral (select at_time at time zone pr.timezone as local_now) l
  cross join lateral (
    select
      l.local_now::date as local_date,
      l.local_now::date::timestamp at time zone pr.timezone as starts,
      (l.local_now::date + 1)::timestamp at time zone pr.timezone as ends
  ) d
  where l.local_now::time >= '21:00' and l.local_now::time < '23:00'
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
