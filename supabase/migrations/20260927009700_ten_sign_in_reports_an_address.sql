-- A sign-in left on Apple's sheet can report twice, the wait and then the answer, and while the app
-- reads active it reports the wait on every try. One address gets ten reports an hour, which holds
-- five such tries with their answers. The cap of sixty for the whole app stays, so one script can't
-- fill the hour and hide real problems.
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

revoke execute on function public.report_sign_in_problem(text, text, text) from public;
grant execute on function public.report_sign_in_problem(text, text, text) to anon, authenticated;
