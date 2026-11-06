-- The settings the app reads when it starts, before anyone signs in.
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is((select apple_web_sign_in from public.app_config), false, 'Sign in with Apple in the browser starts off');

set local role anon;
select is((select apple_web_sign_in from public.app_config), false, 'and the app reads the switch while signed out');
select throws_ok(
  $$ update public.app_config set apple_web_sign_in = true $$,
  '42501', null, 'but only the owner turns it on'
);
reset role;
-- The API sets each request's limit from its role's settings.
select ok(
  (select 'statement_timeout=500ms' = any(rolconfig) from pg_roles where rolname = 'anon'),
  'a request without a session stops after half a second'
);

select * from finish();
rollback;
