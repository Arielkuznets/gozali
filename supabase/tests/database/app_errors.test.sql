-- Error reports from the app: written through report_app_error only, capped per member.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'dan@test.local');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000f1", "role": "authenticated"}', true);

select lives_ok(
  $$ select public.report_app_error('TypeError: x is undefined', repeat('at y ', 2000), '/pack/1', 'ios', '0.1.0', true) $$,
  'a member reports an error'
);
select throws_ok($$ select count(*) from public.app_errors $$, '42501', null, 'but can''t read the reports');
select throws_ok(
  $$ insert into public.app_errors (message, platform) values ('fake', 'ios') $$,
  '42501', null, 'nor write them directly'
);

-- A screen that keeps failing sends 60 more.
select public.report_app_error('Render failed', null, '/me', 'android') from generate_series(1, 60);

reset role;
select is(
  (select count(*) from public.app_errors where user_id = '00000000-0000-0000-0000-0000000000f1'),
  50::bigint,
  'at most 50 a day from one member'
);
select is(
  (select char_length(stack) from public.app_errors where fatal),
  4000,
  'long stacks are cut'
);
select is(
  (select platform from public.app_errors where fatal),
  'ios',
  'the platform is kept'
);

set local role anon;
select throws_ok(
  $$ select public.report_app_error('from nowhere') $$,
  '42501', null, 'signed-out callers can''t report'
);

select * from finish();
rollback;
