-- The sign-in log keeps the email of accounts that were deleted, so a row stays 30 days and no more.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.audit_log_entries (id, payload, created_at, ip_address) values
  ('00000000-0000-4000-8000-0000000000a1', '{"action":"user_deleted"}', now() - interval '30 days 1 hour', ''),
  ('00000000-0000-4000-8000-0000000000a2', '{"action":"user_deleted"}', now() - interval '29 days 23 hours', '');

select is(
  (select count(*) from cron.job where jobname = 'clean-up-auth-log' and active), 1::bigint,
  'the cleanup is scheduled'
);
select lives_ok(
  coalesce((select command from cron.job where jobname = 'clean-up-auth-log'), 'select 1'),
  'its command runs'
);
select ok(
  not exists (select 1 from auth.audit_log_entries where id = '00000000-0000-4000-8000-0000000000a1'),
  'a row past 30 days goes'
);
select ok(
  exists (select 1 from auth.audit_log_entries where id = '00000000-0000-4000-8000-0000000000a2'),
  'a newer one stays'
);

select ok(
  (select proconfig @> array['row_security=off'] from pg_proc where proname = 'clean_up_auth_log'),
  'a role under row level security gets an error, not a delete of nothing'
);
select ok(
  (select prosrc from pg_proc where oid = 'public.clean_up_old_rows(timestamptz)'::regprocedure) !~ 'auth\.',
  'the general cleanup stays out of the auth schema, so a refusal there stops only this job'
);
select ok(
  not has_function_privilege('anon', 'public.clean_up_auth_log(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.clean_up_auth_log(timestamptz)', 'execute'),
  'the app can''t call it'
);

select * from finish();
rollback;
