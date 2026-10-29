-- A member's push tokens come from register_push_token only, at most ten of them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d7', 'noa@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');

select throws_ok(
  $$ insert into public.push_tokens (token, user_id, platform)
     select 'made-up-' || n, '00000000-0000-0000-0000-0000000000d7', 'ios' from generate_series(1, 1000) n $$,
  '42501', null, 'a member can''t write tokens into the table directly'
);

-- Twelve phones, a day apart (in a test everything happens at the same now()).
reset role;
do $$
begin
  for n in 1..12 loop
    perform public.register_push_token('ExponentPushToken[phone-' || n || ']', 'ios');
    update public.push_tokens set updated_at = now() - make_interval(days => 12 - n)
    where token = 'ExponentPushToken[phone-' || n || ']';
  end loop;
end;
$$;
set local role authenticated;
select is(
  (select count(*) from public.push_tokens where user_id = '00000000-0000-0000-0000-0000000000d7'),
  10::bigint,
  'a member keeps ten tokens'
);
select ok(
  not exists (
    select 1 from public.push_tokens where token in ('ExponentPushToken[phone-1]', 'ExponentPushToken[phone-2]')
  ),
  'the oldest go first'
);
select ok(
  exists (select 1 from public.push_tokens where token = 'ExponentPushToken[phone-12]'),
  'the newest stays'
);

-- Signing out still removes the phone's own token.
delete from public.push_tokens where token = 'ExponentPushToken[phone-12]';
select is(
  (select count(*) from public.push_tokens where token = 'ExponentPushToken[phone-12]'),
  0::bigint,
  'a member deletes their own token on signing out'
);

select * from finish();
rollback;
