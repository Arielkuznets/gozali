-- A pack keeps an admin when its admin's account is deleted without leaving first (the developer
-- removing a member from the Auth dashboard, as the report email says to).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e8', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000e9', 'eve@test.local'),
  ('00000000-0000-0000-0000-0000000000e6', 'tal@test.local');

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
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e6');
select public.join_pack((select invite_code from code));
reset role;

-- In a test everything happens at the same now(), so the order of joining is set by hand: Noa,
-- then Tal (who leaves), then Eve, then Dan.
update public.pack_members set joined_at = now() - case user_id
    when '00000000-0000-0000-0000-0000000000e7' then interval '4 days'
    when '00000000-0000-0000-0000-0000000000e6' then interval '3 days'
    when '00000000-0000-0000-0000-0000000000e9' then interval '2 days'
    else interval '1 day'
  end
where pack_id = (select id from pack);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e6');
select public.leave_pack((select id from pack));
reset role;

-- Noa, the admin, is removed from the dashboard: her account goes, nothing leaves first.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e7';

select is(
  (select user_id from public.pack_members where pack_id = (select id from pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000e9'::uuid,
  'admin passes to the longest-standing member'
);
select ok(
  (select role = 'member' from public.pack_members where pack_id = (select id from pack) and user_id = '00000000-0000-0000-0000-0000000000e6'),
  'not to someone who joined earlier but left'
);
select is(
  (select count(*) from public.pack_members where pack_id = (select id from pack) and role = 'admin'),
  1::bigint,
  'and the pack has one admin'
);

-- Eve, the new admin, can run the pack.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e9');
select lives_ok($$ select public.renew_invite_code((select id from pack)) $$, 'the new admin can replace the invite code');
reset role;

-- The last members going leave nobody to pass it to, and nothing breaks.
delete from auth.users where id in (
  '00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000e6'
);
select is(
  (select count(*) from public.pack_members where pack_id = (select id from pack)),
  0::bigint,
  'a pack whose members are all gone has nobody left to be admin'
);

select * from finish();
rollback;
