-- Pack actions: create, preview, join, leave, settings and removing members.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'friend@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'third@test.local');

-- Helper: act as one of the users.
create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- Create.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
create temp table created as
  select public.create_pack('Gym squad', 'gym', 3::smallint, 'mochi', 'Asia/Jerusalem') as id;
select is((select count(*) from public.packs), 1::bigint, 'the creator sees the new pack');
select is((select status::text from public.critters), 'egg', 'the critter starts as an egg');
select is((select role::text from public.pack_members), 'admin', 'the creator is the admin');
select matches((select invite_code from public.packs), '^[A-HJ-NP-Z2-9]{8}$', 'the invite code has the expected format');
select throws_ok(
  $$ select public.create_pack('Nowhere', 'gym', 3::smallint, 'mochi', 'Mars/Olympus') $$,
  '22023', 'unknown_time_zone', 'the time zone must be a real one'
);
select throws_ok(
  $$ select public.create_pack('Wrong', 'custom', 1::smallint, 'mochi', 'UTC') $$,
  '23514', null, 'custom packs need a habit text'
);

-- Preview and join, as the friend.
create temp table code as select invite_code from public.packs;
grant select on created, code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from public.packs), 0::bigint, 'a stranger does not see the pack');
select is(
  (select member_count from public.pack_preview((select lower(invite_code) from code))),
  1,
  'the preview works with a lower-case code and shows the member count'
);
select is(
  (select (critter ->> 'status') || ' ' || array_length(member_names, 1) from public.pack_preview((select invite_code from code))),
  'egg 1',
  'and the critter as it is, with who is in the pack'
);
select is(public.join_pack((select invite_code from code)), (select id from created), 'joining returns the pack');
select is((select count(*) from public.pack_members), 2::bigint, 'after joining the friend sees both members');
select is(public.join_pack((select invite_code from code)), (select id from created), 'joining twice is harmless');
select is(public.join_pack('ZZZZ2222'), null, 'an unknown code joins nothing');
select throws_ok(
  $$ select public.update_pack((select id from created), 'Mine now', 3::smallint, 'sunday') $$,
  '42501', 'admin_only', 'only the admin changes settings'
);

-- Settings, as the admin.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.update_pack((select id from created), 'Gym gang', 2::smallint, 'sunday');
select is((select name from public.packs), 'Gym gang', 'the name changes right away');
select is((select rest_days_per_week from public.packs), 3::smallint, 'rest days wait for the next week');
select is((select pending_rest_days_per_week from public.packs), 2::smallint, 'and are stored as pending');
select is(
  (select extract(dow from pending_from)::int from public.packs),
  0,
  'the pending change starts on a Sunday'
);
select throws_ok(
  $$ select public.update_pack((select id from created), 'No rest', null, 'sunday') $$,
  '22023', 'bad_settings', 'the rest days must be given'
);
select throws_ok(
  $$ select public.update_pack((select id from created), 'No start', 2::smallint, null) $$,
  '22023', 'bad_settings', 'and the week start'
);
select is(
  (select name || ': ' || pending_rest_days_per_week || ', ' || pending_week_start from public.packs),
  'Gym gang: 2, sunday',
  'and a refused save changes nothing'
);

-- The admin leaves; the longest-standing member takes over.
select public.leave_pack((select id from created));
reset role;
select is(
  (select role::text from public.pack_members where user_id = '00000000-0000-0000-0000-0000000000b1'),
  'admin',
  'the friend becomes admin when the admin leaves'
);
select is(
  (select status::text from public.pack_members where user_id = '00000000-0000-0000-0000-0000000000a1'),
  'left',
  'the old admin is marked as left'
);

-- A full pack refuses new members.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-00000000f0' || lpad(n::text, 2, '0'))::uuid, 'f' || n || '@test.local'
from generate_series(1, 7) as n;
insert into public.pack_members (pack_id, user_id)
select (select id from created), ('00000000-0000-0000-0000-00000000f0' || lpad(n::text, 2, '0'))::uuid
from generate_series(1, 7) as n;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.join_pack((select invite_code from code)) $$, 'P0001', 'pack_full', 'a full pack refuses new members');

-- The day close reads a pack's zone with Intl, so a pack's zone is one it can read.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'zones@test.local');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(
  (select count(*) from pg_catalog.pg_timezone_names where name in ('posix/Asia/Jerusalem', 'Factory')), 2::bigint,
  'Postgres lists names the day close can''t count on Intl to read'
);
select throws_ok(
  $$ select public.create_pack('Nowhere', 'gym', 3::smallint, 'mochi', 'posix/Asia/Jerusalem') $$,
  '22023', 'unknown_time_zone', 'a pack can''t be made in one, or the close could take its days only one a run'
);
select throws_ok(
  $$ select public.create_pack('Nowhere', 'gym', 3::smallint, 'mochi', 'Factory') $$,
  '22023', 'unknown_time_zone', 'nor in the zone of no place'
);
-- Coyhaique is a real place the day close's Intl doesn't know yet, so its packs go by the same clock.
create temp table aysen as
  select public.create_pack('Aysen', 'gym', 3::smallint, 'mochi', 'America/Coyhaique') as id;
select is(
  (select timezone from public.packs where id = (select id from aysen)), 'America/Punta_Arenas',
  'a phone in a zone the day close can''t read yet still makes a pack, on a clock it can'
);
select is(
  (select count(*) from generate_series(now(), now() + interval '10 years', interval '1 hour') t
   where (t at time zone 'America/Coyhaique') <> (t at time zone 'America/Punta_Arenas')),
  0::bigint,
  'and that clock is the same for all the days it will count'
);
create temp table old_name as
  select public.create_pack('Kolkata', 'gym', 3::smallint, 'mochi', 'Asia/Calcutta') as id;
select is(
  (select timezone from public.packs where id = (select id from old_name)), 'Asia/Calcutta',
  'the name a phone gives stays as it is, an old one too'
);

select * from finish();
rollback;
