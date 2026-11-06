-- A member's push tokens come from register_push_token only, at most ten of them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000d8', 'tal@test.local'),
  ('00000000-0000-0000-0000-0000000000d9', 'maya@test.local');

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

select throws_ok(
  $$ select public.register_push_token(repeat('x', 201), 'ios') $$,
  '22023', 'invalid_token', 'a token longer than 200 characters is refused'
);
select throws_ok(
  $$ select public.register_push_token('', 'ios') $$,
  '22023', 'invalid_token', 'and so is an empty one'
);

-- A phone may forget a token because it holds it: signing out may leave it no session to do so.
reset role;
insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[signed-out]', '00000000-0000-0000-0000-0000000000d8', 'ios'),
  ('ExponentPushToken[same-account]', '00000000-0000-0000-0000-0000000000d8', 'android'),
  ('ExponentPushToken[other-account]', '00000000-0000-0000-0000-0000000000d9', 'ios');

set local role anon;
select lives_ok(
  $$ select public.forget_push_token('ExponentPushToken[signed-out]') $$,
  'someone who isn''t signed in forgets a token by its value'
);
select lives_ok(
  $$ select public.forget_push_token('ExponentPushToken[never-registered]') $$,
  'a token the server doesn''t hold is no error'
);
select throws_ok(
  $$ delete from public.push_tokens where token = 'ExponentPushToken[same-account]' $$,
  '42501', null, 'the table itself stays closed to them'
);

reset role;
select is(
  (select count(*) from public.push_tokens where token = 'ExponentPushToken[signed-out]'),
  0::bigint,
  'the token is gone'
);
select is(
  (select array_agg(token order by token) from public.push_tokens
   where user_id in ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000d9')),
  array['ExponentPushToken[other-account]', 'ExponentPushToken[same-account]'],
  'and only that one: the account''s other phone and other accounts keep theirs'
);
select is(
  (select count(*) from public.push_tokens where user_id = '00000000-0000-0000-0000-0000000000d7'),
  9::bigint,
  'and a third account''s tokens are untouched'
);

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select public.forget_push_token('ExponentPushToken[other-account]');
reset role;
select is(
  (select count(*) from public.push_tokens where token = 'ExponentPushToken[other-account]'),
  0::bigint,
  'a signed-in phone can forget a token too, whoever''s row it is'
);

-- What Expo itself takes for a token: its two bracket forms and a UUID. Anything else would only
-- come back refused, on every try.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d9');
select throws_ok(
  $$ select public.register_push_token('x', 'ios') $$,
  '22023', 'invalid_token', 'text that can''t be a token is refused'
);
select throws_ok(
  $$ select public.register_push_token('my phone', 'android') $$,
  '22023', 'invalid_token', 'and so is free text'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[no-end', 'ios') $$,
  '22023', 'invalid_token', 'and half a token'
);
select throws_ok(
  $$ select public.register_push_token('a1b2c3d4-e5f6-7890-abcd', 'ios') $$,
  '22023', 'invalid_token', 'and part of a UUID'
);
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[abc123]', 'ios') $$,
  'the usual form is taken'
);
select lives_ok(
  $$ select public.register_push_token('ExpoPushToken[abc123]', 'android') $$,
  'and the shorter form'
);
select lives_ok(
  $$ select public.register_push_token('A1B2C3D4-E5F6-7890-ABCD-EF1234567890', 'ios') $$,
  'and the UUID form'
);

select * from finish();
rollback;
