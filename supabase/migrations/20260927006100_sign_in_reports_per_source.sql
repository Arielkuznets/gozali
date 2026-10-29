-- Sign-in problem reports are also capped per address (2026-10-29): five an hour from one, under the
-- cap of sixty for the whole app, so one script can't fill the hour and hide real problems. The
-- address is the one Cloudflare puts in CF-Connecting-IP in front of the API, which a caller can't
-- set; without it (a local stack) only the app-wide cap applies. What is kept is a hash keyed by a
-- secret in Vault and by the hour, so it can't be turned back into an address, and it goes with the
-- next report after the hour or the daily cleanup.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'sign_in_report_salt',
  'Keys the address hashes report_sign_in_problem keeps for an hour'
);

create table public.sign_in_report_sources (
  source text not null,
  at timestamptz not null default now()
);
create index sign_in_report_sources_by_source on public.sign_in_report_sources (source, at);
alter table public.sign_in_report_sources enable row level security;
revoke all on public.sign_in_report_sources from anon, authenticated;

create or replace function public.report_sign_in_problem(
  problem text,
  device text default 'web',
  app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := nullif(current_setting('request.headers', true)::json ->> 'cf-connecting-ip', '');
  caller_source text;
begin
  if problem is null then
    return;
  end if;
  delete from public.sign_in_report_sources s where s.at < now() - interval '1 hour';
  if (
    select count(*) from public.app_errors e
    where e.screen = 'sign-in' and e.created_at > now() - interval '1 hour'
  ) >= 60 then
    return;
  end if;
  if address is not null then
    caller_source := md5(
      address
      || coalesce((select v.decrypted_secret from vault.decrypted_secrets v where v.name = 'sign_in_report_salt'), '')
      || date_trunc('hour', now())::text
    );
    if (select count(*) from public.sign_in_report_sources s where s.source = caller_source) >= 5 then
      return;
    end if;
    insert into public.sign_in_report_sources (source) values (caller_source);
  end if;
  insert into public.app_errors (user_id, message, screen, platform, app_version)
  values (
    (select auth.uid()),
    left(problem, 500),
    'sign-in',
    case when device in ('ios', 'android') then device else 'web' end,
    left(app_version, 50)
  );
end;
$$;

-- The daily cleanup takes the hashes too, in case no report came after them.
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
  delete from public.sign_in_report_sources where at < at_time - interval '1 hour';
  delete from cron.job_run_details where end_time < at_time - interval '7 days';
$$;
