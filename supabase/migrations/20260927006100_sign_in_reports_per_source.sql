-- Sign-in problem reports are also capped per source (2026-10-29): five an hour from one address,
-- under the cap of sixty for the whole app, so one script can't fill the hour and hide real
-- problems. Only a hash of the address is kept, and only for the hour it counts.
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
  -- The caller's address as the API gateway passes it; the first one when there are several.
  caller_source text := md5(coalesce(
    split_part(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1), ''
  ));
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
  if (select count(*) from public.sign_in_report_sources s where s.source = caller_source) >= 5 then
    return;
  end if;
  insert into public.sign_in_report_sources (source) values (caller_source);
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
