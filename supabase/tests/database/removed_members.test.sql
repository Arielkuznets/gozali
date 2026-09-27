-- A removed member stays out; a member who left can come back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'maya@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
create temp table pack as select public.create_pack('Gym squad', 'gym', 0::smallint, 'kit', 'UTC') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select public.join_pack((select invite_code from code));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d3');
select public.join_pack((select invite_code from code));

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select lives_ok(
  $$ select public.remove_member((select id from pack), '00000000-0000-0000-0000-0000000000d2') $$,
  'the admin removes Dan'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok(
  $$ select public.join_pack((select invite_code from code)) $$,
  'P0001', 'removed_from_pack', 'Dan can''t come back with the invite code'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d3');
select lives_ok($$ select public.leave_pack((select id from pack)) $$, 'Maya leaves on her own');
select is(public.join_pack((select invite_code from code)), (select id from pack), 'and can come back');

reset role;
select is(
  (select string_agg(p.email || ':' || m.status, ', ' order by p.email)
   from public.pack_members m join auth.users p on p.id = m.user_id),
  'dan@test.local:left, maya@test.local:active, noa@test.local:active',
  'Dan stays out, Maya is back'
);

select * from finish();
rollback;
