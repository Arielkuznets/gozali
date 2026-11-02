-- Opening home costs what the caller's packs cost, not what the whole app costs. Who gets a pack is
-- the same under any plan: members and sleepers do, people who left or were removed don't.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.plan_of(statement text) returns text
language plpgsql as $$
declare
  line text;
  whole text := '';
begin
  for line in execute 'explain ' || statement loop
    whole := whole || line || chr(10);
  end loop;
  return whole;
end;
$$;

create function pg_temp.feed_rows_touched() returns bigint language sql as $$
  select seq_tup_read + coalesce(idx_tup_fetch, 0) from pg_stat_xact_user_tables where relid = 'public.feeds'::regclass;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'sam@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'lea@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', 'rob@test.local'),
  ('00000000-0000-0000-0000-0000000000f5', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000f6', 'eve@test.local');

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
create temp table gym as select public.create_pack('Gym squad', 'gym', 0::smallint, 'kit', 'UTC') as id;
create temp table code as select invite_code from public.packs;
grant select on gym, code to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select public.join_pack((select invite_code from code));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
select public.join_pack((select invite_code from code));
select public.leave_pack((select id from gym));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f4');
select public.join_pack((select invite_code from code));
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select public.remove_member((select id from gym), '00000000-0000-0000-0000-0000000000f4');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f5');
create temp table books as select public.create_pack('Readers', 'reading', 0::smallint, 'kit', 'UTC') as id;
grant select on books to authenticated;
reset role;

update public.pack_members set status = 'sleeping' where user_id = '00000000-0000-0000-0000-0000000000f2';

create temp table today as select (now() at time zone 'utc')::date as day;
grant select on today to authenticated;
insert into public.feeds (pack_id, user_id, day)
select gym.id, '00000000-0000-0000-0000-0000000000f1', today.day from gym, today;

-- The rest of the app: 100 packs of one member with three recent counted feeds each.
insert into auth.users (id, email)
  select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'u' || n || '@test.local'
  from generate_series(1, 100) n;
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
  select ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Pack ' || n, 'gym', 1, 'UTC',
    lpad(translate(n::text, '01', 'CD'), 8, 'A')
  from generate_series(1, 100) n;
insert into public.pack_members (pack_id, user_id, role, status)
  select ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'admin', 'active'
  from generate_series(1, 100) n;
insert into public.feeds (pack_id, user_id, day)
  select ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
    ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, today.day - back
  from today, generate_series(1, 100) n, generate_series(0, 2) back;

set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select results_eq($$ select id from public.packs $$, $$ select id from gym $$, 'a member gets their pack and no other');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select results_eq($$ select id from public.packs $$, $$ select id from gym $$, 'so does a member who fell asleep');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
select is_empty($$ select id from public.packs $$, 'someone who left gets nothing');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f4');
select is_empty($$ select id from public.packs $$, 'nor does someone the admin removed');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f5');
select results_eq($$ select id from public.packs $$, $$ select id from books $$, 'a stranger gets only their own pack');
select is_empty($$ select id from public.packs where id = (select id from gym) $$, 'and nothing by another pack''s id');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6');
select is_empty($$ select id from public.packs $$, 'someone in no pack gets nothing');

-- One connection serves one person after another and keeps its plans between them.
set local plan_cache_mode = force_generic_plan;
prepare list_packs as select id from public.packs;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select results_eq('list_packs', $$ select id from gym $$, 'a kept plan answers for the person asking');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f5');
select results_eq('list_packs', $$ select id from books $$, 'and for the next person on that connection');
set local plan_cache_mode = auto;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
select unalike(
  pg_temp.plan_of($$ select id from public.packs order by created_at $$),
  '%is_pack_member%',
  'the packs list works out the caller''s packs once, not once per pack in the app'
);

-- A table this small is cheapest to read whole under any plan, so the test takes that choice away.
-- The statistics are what a database in use has: without any, the planner guesses at the join.
reset role;
analyze public.pack_members, public.feeds;
set local enable_seqscan = off;
create temp table touched as select pg_temp.feed_rows_touched() as rows;
set local role authenticated;
select results_eq(
  $$ select pack_id, user_id, day from public.counted_feeds() $$,
  $$ select gym.id, '00000000-0000-0000-0000-0000000000f1'::uuid, today.day from gym, today $$,
  'the counted feeds are those of the caller''s pack'
);
reset role;
select cmp_ok(
  pg_temp.feed_rows_touched() - (select rows from touched), '<=', 5::bigint,
  'and reading them touches no row of the 100 other packs'
);
set local enable_seqscan = on;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f5');
select results_eq($$ select public.my_pack_ids() $$, $$ select id from books $$, 'the caller''s packs are all anyone can ask for');
reset role;

select ok(
  has_function_privilege('authenticated', 'public.my_pack_ids()', 'execute')
    and not has_function_privilege('anon', 'public.my_pack_ids()', 'execute'),
  'signed-in people can call it, signed-out clients cannot'
);

set local role anon;
select throws_ok($$ select id from public.packs $$, '42501', 'permission denied for table packs', 'signed out, no packs at all');

select * from finish();
rollback;
