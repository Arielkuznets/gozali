-- Sign-in problems from people who aren't signed in yet (2026-10-28). App Review couldn't sign in
-- with Apple on an iPad, and nothing reached the server, so there was nothing to go on. The
-- welcome screen now reports what went wrong (the error code, the system and its version) to
-- app_errors with the screen 'sign-in', next to the other app errors and in the owner's daily
-- count. Anyone can call it, so sign-in rows are capped for the whole app per hour and long texts
-- are cut.
create function public.report_sign_in_problem(
  problem text,
  device text default 'web',
  app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if problem is null then
    return;
  end if;
  if (
    select count(*) from public.app_errors e
    where e.screen = 'sign-in' and e.created_at > now() - interval '1 hour'
  ) >= 60 then
    return;
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
