-- A pack keeps an admin when its admin's account is deleted without leaving first (the developer
-- removing a member from the Auth dashboard, as the report email says to).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e8', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000e9', 'eve@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e7');
create temp table pack as select public.create_pack('Gym squad', 'gym', 1::smallint, 'kit', 'UTC') as id;
create temp table code as select invite_code from public.packs where id = (select id from pack);
grant select on pack, code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e8');
select public.join_pack((select invite_code from code));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e9');
select public.join_pack((select invite_code from code));
reset role;

-- Noa, the admin, is removed from the dashboard: her account goes, nothing leaves first.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e7';

select is(
  (select user_id from public.pack_members where pack_id = (select id from pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000e8'::uuid,
  'admin passes to the longest-standing member'
);
select is(
  (select count(*) from public.pack_members where pack_id = (select id from pack) and role = 'admin'),
  1::bigint,
  'and the pack has one admin'
);

-- Dan, the new admin, can run the pack.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e8');
select lives_ok($$ select public.renew_invite_code((select id from pack)) $$, 'the new admin can replace the invite code');
reset role;

-- The last members going leave nobody to pass it to, and nothing breaks.
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e9');
select is(
  (select count(*) from public.pack_members where pack_id = (select id from pack)),
  0::bigint,
  'a pack whose members are all gone has nobody left to be admin'
);

select * from finish();
rollback;
