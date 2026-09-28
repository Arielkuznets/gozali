-- Guessing invite codes: misses are counted, and 20 in an hour stop the answers for that hour.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000bb', 'eve@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000aa');
create temp table pack as select public.create_pack('Runners', 'running', 1::smallint, 'kit', 'UTC') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000bb');
select is((select count(*) from public.pack_preview('ZZZZZZZZ')), 0::bigint, 'a wrong code shows no pack');
select is(public.join_pack('ZZZZZZZY'), null, 'joining with a wrong code returns nothing, not an error');
select is((select count(*) from public.pack_preview((select invite_code from code))), 1::bigint, 'the right code shows the pack');

reset role;
select is(
  (select count(*) from public.code_misses where user_id = '00000000-0000-0000-0000-0000000000bb'),
  2::bigint,
  'both misses are counted, the hit is not'
);
insert into public.code_misses (user_id)
select '00000000-0000-0000-0000-0000000000bb' from generate_series(1, 18);

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000bb');
select throws_ok(
  $$ select * from public.pack_preview((select invite_code from code)) $$,
  'P0001', 'too_many_attempts', 'after 20 misses in an hour even the right code gets no answer'
);
select throws_ok(
  $$ select public.join_pack((select invite_code from code)) $$,
  'P0001', 'too_many_attempts', 'and joining waits too'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000aa');
select is((select count(*) from public.pack_preview((select invite_code from code))), 1::bigint, 'other people are not affected');

select * from finish();
rollback;
