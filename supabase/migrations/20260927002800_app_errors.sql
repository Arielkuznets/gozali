-- Errors the app ran into on members' phones: a screen that failed to draw, or a JavaScript
-- error that closed the app. Problems in the pilot show up here without waiting for someone to
-- mention them:
--   npx supabase db query --linked "select * from app_errors order by created_at desc limit 50"
-- Written only through report_app_error; nobody reads them from the app.
create table public.app_errors (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  message text not null,
  stack text,
  screen text,
  platform text not null check (platform in ('ios', 'android', 'web')),
  app_version text,
  fatal boolean not null default false
);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
create index app_errors_by_user on public.app_errors (user_id, created_at);

-- A broken screen can throw on every draw, so each member sends at most 50 a day; the rest are
-- dropped quietly. Long texts are cut.
create function public.report_app_error(
  error_message text,
  error_stack text default null,
  screen text default null,
  device text default 'web',
  app_version text default null,
  fatal boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or error_message is null then
    return;
  end if;
  if (
    select count(*) from public.app_errors e
    where e.user_id = caller and e.created_at > now() - interval '1 day'
  ) >= 50 then
    return;
  end if;
  insert into public.app_errors (user_id, message, stack, screen, platform, app_version, fatal)
  values (
    caller,
    left(error_message, 500),
    left(error_stack, 4000),
    left(screen, 200),
    case when device in ('ios', 'android') then device else 'web' end,
    left(app_version, 50),
    coalesce(fatal, false)
  );
end;
$$;
revoke execute on function public.report_app_error(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.report_app_error(text, text, text, text, text, boolean) to authenticated;

-- Error reports are kept for 30 days, like sent notifications.
create or replace function public.clean_up_old_rows(at_time timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications where status <> 'pending' and created_at < at_time - interval '30 days';
  delete from public.widget_tokens where coalesce(last_used_at, created_at) < at_time - interval '90 days';
  delete from public.app_errors where created_at < at_time - interval '30 days';
$$;
