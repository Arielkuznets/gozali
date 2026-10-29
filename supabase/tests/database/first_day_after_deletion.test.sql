-- A pack keeps closing its days after a member deletes their account (their memberships go with it).
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'eve@test.local'),
  ('00000000-0000-0000-0000-0000000000e4', 'tal@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

-- What the engine sends for a quiet day.
create function pg_temp.neutral_day() returns jsonb language sql as $$
  select jsonb_build_object(
    'type', 'neutral', 'applied', false, 'healthBefore', 70, 'coins', 0,
    'critter', jsonb_build_object('status', 'egg', 'health', 70, 'xp', 0, 'stage', 'egg', 'streak', 0, 'marks', '[]'::jsonb),
    'outcomes', '[]'::jsonb, 'newlySleeping', '[]'::jsonb, 'events', '[]'::jsonb,
    'facts', jsonb_build_object('earlyBird', false, 'fullHouse', false, 'nightOwlFeeds', 0)
  );
$$;

-- Noa's pack: Dan joins, a day closes, then Noa deletes her account the way the app does it.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
create temp table pack as select public.create_pack('Gym squad', 'gym', 0::smallint, 'kit', 'UTC') as id;
create temp table code as select invite_code from public.packs where id = (select id from pack);
grant select on pack, code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
select public.join_pack((select invite_code from code));
reset role;

create temp table opening as select public.pack_first_day(id) as first_day from pack;
select public.apply_day_result((select id from pack), (select first_day from opening), pg_temp.neutral_day());

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
select public.leave_pack((select id from pack));
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';

select is(public.pack_first_day((select id from pack)), (select first_day from opening), 'the first day stays after Noa''s account is gone');
select ok(
  public.apply_day_result((select id from pack), (select first_day + 1 from opening), pg_temp.neutral_day()),
  'the next day closes'
);
select is(
  (select next_day from public.packs_to_close(now() + interval '30 days') where pack_id = (select id from pack)),
  (select first_day + 2 from opening),
  'and the close goes on from the day after'
);

-- Eve's pack: Tal joins and deletes his account before any day closed, so the egg waits again.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e3');
create temp table waiting as select public.create_pack('Readers', 'reading', 0::smallint, 'kit', 'UTC') as id;
create temp table waiting_code as select invite_code from public.packs where id = (select id from waiting);
grant select on waiting, waiting_code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e4');
select public.join_pack((select invite_code from waiting_code));
select public.leave_pack((select id from waiting));
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e4';

select is(public.pack_first_day((select id from waiting)), null, 'a pack that never closed a day has no first day with one member');
select is(
  (select count(*) from public.packs_to_close(now() + interval '30 days') where pack_id = (select id from waiting)),
  0::bigint,
  'and its days don''t close'
);

select * from finish();
rollback;
