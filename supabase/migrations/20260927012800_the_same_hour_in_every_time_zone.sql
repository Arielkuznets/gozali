-- One address reports ten sign-in problems an hour, and the hour goes into the hash of its source.
-- A request names its own time zone (Prefer: timezone), and a time as text, or cut to the hour,
-- follows that zone: each zone would be an hour of its own, with its own ten, and one script could
-- fill the app's sixty. The number of the hour since 1970 is the same in every zone.
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
      || floor(extract(epoch from now()) / 3600)::bigint::text
    );
    if (select count(*) from public.sign_in_report_sources s where s.source = caller_source) >= 10 then
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
