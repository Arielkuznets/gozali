-- A pack keeps an admin when its admin's account is deleted without leaving first (the developer
-- removing a member from the Auth dashboard, as the report email says to). The role goes to a
-- member who plays: awake before asleep, then someone who fed since joining, then the longest-standing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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

-- Ari's pack, in the order of joining: Ari the admin, Bea who fed and is asleep, Cy who fed only
-- before he left and came back, Di who feeds. Eli's pack is the same: Eli, Fay, Gil, Hod.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ari@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'bea@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'cy@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'di@test.local'),
  ('00000000-0000-0000-0000-0000000000a5', 'eli@test.local'),
  ('00000000-0000-0000-0000-0000000000a6', 'fay@test.local'),
  ('00000000-0000-0000-0000-0000000000a7', 'gil@test.local'),
  ('00000000-0000-0000-0000-0000000000a8', 'hod@test.local');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
create temp table ari_pack as select public.create_pack('Run club', 'running', 1::smallint, 'mochi', 'UTC') as id;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a5');
create temp table eli_pack as select public.create_pack('Readers', 'reading', 0::smallint, 'hoot', 'UTC') as id;
reset role;
create temp table codes as
select (select invite_code from public.packs where id = (select id from ari_pack)) as ari,
  (select invite_code from public.packs where id = (select id from eli_pack)) as eli;
grant select on ari_pack, eli_pack, codes to authenticated;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select public.join_pack((select ari from codes));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select public.join_pack((select ari from codes));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select public.join_pack((select ari from codes));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a6');
select public.join_pack((select eli from codes));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select public.join_pack((select eli from codes));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a8');
select public.join_pack((select eli from codes));
reset role;

update public.pack_members set joined_at = now() - case user_id
    when '00000000-0000-0000-0000-0000000000a1' then interval '10 days'
    when '00000000-0000-0000-0000-0000000000a5' then interval '10 days'
    when '00000000-0000-0000-0000-0000000000a2' then interval '9 days'
    when '00000000-0000-0000-0000-0000000000a6' then interval '9 days'
    when '00000000-0000-0000-0000-0000000000a3' then interval '8 days'
    when '00000000-0000-0000-0000-0000000000a7' then interval '8 days'
    else interval '7 days'
  end
where pack_id in ((select id from ari_pack), (select id from eli_pack));
update public.pack_members set status = 'sleeping'
where user_id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a6');
insert into public.feeds (pack_id, user_id, day)
select pack_id, user_id, public.pack_day('UTC') - case
    when user_id in ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a6') then 6
    when user_id in ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a7') then 9
    else 1
  end
from public.pack_members
where pack_id in ((select id from ari_pack), (select id from eli_pack)) and role = 'member';

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.leave_pack((select id from ari_pack));
reset role;
select is(
  (select user_id from public.pack_members where pack_id = (select id from ari_pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000a4'::uuid,
  'the admin leaving hands the role past an older sleeper and an older member who never fed since joining'
);

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select public.leave_pack((select id from ari_pack));
reset role;
select is(
  (select user_id from public.pack_members where pack_id = (select id from ari_pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  'someone awake who never fed since joining comes before someone asleep'
);

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select public.leave_pack((select id from ari_pack));
reset role;
select is(
  (select user_id from public.pack_members where pack_id = (select id from ari_pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  'a pack of only sleepers still gets an admin'
);

delete from auth.users where id = '00000000-0000-0000-0000-0000000000a5';
select is(
  (select user_id from public.pack_members where pack_id = (select id from eli_pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000a8'::uuid,
  'a deleted admin''s role goes by the same order'
);

delete from auth.users where id in ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a8');
select is(
  (select user_id from public.pack_members where pack_id = (select id from eli_pack) and role = 'admin'),
  '00000000-0000-0000-0000-0000000000a6'::uuid,
  'and reaches a sleeper when nobody else is left'
);

select * from finish();
rollback;
