-- The settings the app reads when it starts, before anyone signs in.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is((select apple_web_sign_in from public.app_config), false, 'Sign in with Apple in the browser starts off');

set local role anon;
select is((select apple_web_sign_in from public.app_config), false, 'and the app reads the switch while signed out');
select throws_ok(
  $$ update public.app_config set apple_web_sign_in = true $$,
  '42501', null, 'but only the owner turns it on'
);

select * from finish();
rollback;
