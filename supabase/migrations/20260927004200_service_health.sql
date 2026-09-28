-- Failures on the server were visible only to someone who ran the health queries in
-- docs/setup.md (pre-release audit, 2026-09-28). Now the calls from the database to the functions
-- that didn't answer 200 are kept for 30 days (pg_net forgets them after 6 hours), and the owners'
-- daily summary counts them with failed scheduled jobs, outages and packs whose day close is late.

create table public.service_errors (
  response_id bigint primary key,
  status integer,
  detail text,
  at timestamptz not null
);
alter table public.service_errors enable row level security;
revoke all on public.service_errors from anon, authenticated;

create function public.collect_service_errors()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  collected integer;
begin
  insert into public.service_errors (response_id, status, detail, at)
  select r.id, r.status_code, left(coalesce(r.error_msg, r.content::text, ''), 300), r.created
  from net._http_response r
  where r.status_code is distinct from 200 or r.timed_out
  on conflict do nothing;
  get diagnostics collected = row_count;
  return collected;
end;
$$;

revoke execute on function public.collect_service_errors() from public, anon, authenticated;

select cron.schedule('collect-service-errors', '*/5 * * * *', $$select public.collect_service_errors()$$);

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
      where j.status <> 'succeeded' and j.start_time >= d.starts and j.start_time < d.ends
    ),
    'downHours', (
      select coalesce(round(sum(extract(epoch from least(x.ends_at, d.ends) - greatest(x.starts_at, d.starts))) / 3600), 0)
      from public.outages x
      where x.starts_at < d.ends and x.ends_at > d.starts
    ),
    'packsBehind', (select count(*) from public.packs_to_close(at_time - interval '1 hour'))
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

create or replace function public.clean_up_old_rows(at_time timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications where status <> 'pending' and created_at < at_time - interval '30 days';
  delete from public.widget_tokens where coalesce(last_used_at, created_at) < at_time - interval '90 days';
  delete from public.app_errors where created_at < at_time - interval '30 days';
  delete from public.code_misses where at < at_time - interval '1 day';
  delete from public.service_errors where at < at_time - interval '30 days';
  delete from cron.job_run_details where end_time < at_time - interval '7 days';
$$;
