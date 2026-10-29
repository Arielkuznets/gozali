-- A failed sign-in can be reported before anyone is signed in, within a cap for the whole app.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

set local role anon;
select lives_ok(
  $$ select public.report_sign_in_problem('apple ERR_REQUEST_UNKNOWN: failed (iPadOS 27.0)', 'ios', '1.0.0') $$,
  'someone who isn''t signed in reports a failed sign-in'
);
select throws_ok($$ select count(*) from public.app_errors $$, '42501', null, 'but can''t read the reports');
select public.report_sign_in_problem(repeat('x', 900), 'tv', null);
select public.report_sign_in_problem(null, 'ios', null);
reset role;

select is(
  (select string_agg(coalesce(user_id::text, 'nobody') || ' ' || screen || ' ' || platform || ' ' || coalesce(app_version, '-'), ', ' order by id)
   from public.app_errors where screen = 'sign-in' and message like 'apple%'),
  'nobody sign-in ios 1.0.0',
  'the report keeps the problem, the platform and the version'
);
select is(
  (select length(message) || ' ' || platform from public.app_errors where screen = 'sign-in' and message like 'xxx%'),
  '500 web',
  'long texts are cut and unknown platforms count as web'
);
select is((select count(*) from public.app_errors where screen = 'sign-in'), 2::bigint, 'an empty report is ignored');

-- The cap: 60 sign-in reports an hour for the whole app.
insert into public.app_errors (message, screen, platform)
select 'earlier problem', 'sign-in', 'ios' from generate_series(1, 58);
set local role anon;
select public.report_sign_in_problem('one too many', 'ios', null);
reset role;
select is((select count(*) from public.app_errors where message = 'one too many'), 0::bigint, 'reports past the hourly cap are dropped');

select * from finish();
rollback;
