-- Rows that grew without end (pre-release audit, 2026-09-28): pg_cron keeps a row for every run,
-- about 1,800 a day or 135 MB a year, and the invite code misses only matter for an hour. The
-- daily clean-up now trims both.
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
  delete from cron.job_run_details where end_time < at_time - interval '7 days';
$$;
