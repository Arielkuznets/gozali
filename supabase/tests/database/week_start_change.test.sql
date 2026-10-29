-- A pack's week moving to another start day (decision D24).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'dan@test.local');

-- What the engine sends for a quiet day, with whoever rested.
create function pg_temp.quiet_day(rested uuid[]) returns jsonb language sql as $$
  select jsonb_build_object(
    'type', 'neutral', 'applied', false, 'healthBefore', 70, 'coins', 0,
    'critter', jsonb_build_object('status', 'egg', 'health', 70, 'xp', 0, 'stage', 'egg', 'streak', 0, 'marks', '[]'::jsonb),
    'outcomes', coalesce((select jsonb_agg(jsonb_build_object('userId', r, 'outcome', 'rest')) from unnest(rested) r), '[]'::jsonb),
    'newlySleeping', '[]'::jsonb, 'events', '[]'::jsonb,
    'facts', jsonb_build_object('earlyBird', false, 'fullHouse', false, 'nightOwlFeeds', 0)
  );
$$;

-- Closes a day the way the close-days function does, keeping what it was given, and then what
-- the commit after it does (the recap).
create temp table inputs (pack_id uuid, day date, input jsonb);
create function pg_temp.close(target uuid, pack_date date, rested uuid[] default '{}') returns void language plpgsql as $$
begin
  insert into inputs values (target, pack_date, public.day_close_input(target, pack_date));
  perform public.apply_day_result(target, pack_date, pg_temp.quiet_day(rested));
  set constraints all immediate;
  set constraints all deferred;
end;
$$;

create function pg_temp.add_pack(id uuid, code text, starts public.week_start, rest smallint, first_day date) returns void language sql as $$
  insert into public.packs (id, name, category, rest_days_per_week, week_start, timezone, invite_code)
  values (id, 'Week test', 'gym', rest, starts, 'UTC', code);
  insert into public.critters (pack_id, species) values (id, 'kit');
  insert into public.pack_members (pack_id, user_id, role, joined_at) values
    (id, '00000000-0000-0000-0000-0000000000f1', 'admin', first_day + interval '8 hours'),
    (id, '00000000-0000-0000-0000-0000000000f2', 'member', first_day + interval '9 hours');
$$;

create function pg_temp.recaps(target uuid) returns text language sql as $$
  select string_agg(week_start || '..' || (stats ->> 'weekEnd') || ' (' || (stats ->> 'days') || ')', ', ' order by week_start)
  from public.weekly_recaps where pack_id = target;
$$;

-- Sunday to Monday, from Sunday Oct 11: the Sunday in between joins the first Monday week.
-- Dan rests on the last day of the old week.
select pg_temp.add_pack('10000000-0000-0000-0000-0000000000f1', 'WEEKAAAA', 'sunday', 1::smallint, '2026-10-04');
update public.packs set pending_week_start = 'monday', pending_rest_days_per_week = 1, pending_from = '2026-10-11'
where id = '10000000-0000-0000-0000-0000000000f1';
select pg_temp.close('10000000-0000-0000-0000-0000000000f1', d::date,
  case when d = '2026-10-10' then array['00000000-0000-0000-0000-0000000000f2'::uuid] else '{}' end)
from generate_series('2026-10-04'::date, '2026-10-25'::date, interval '1 day') d;

select is(
  pg_temp.recaps('10000000-0000-0000-0000-0000000000f1'),
  '2026-10-04..2026-10-10 (7), 2026-10-11..2026-10-18 (8), 2026-10-19..2026-10-25 (7)',
  'Sunday to Monday: the running week ends with its recap, and the first Monday week takes the Sunday before it'
);
select is(
  (select sum((stats ->> 'days')::int) from public.weekly_recaps where pack_id = '10000000-0000-0000-0000-0000000000f1'),
  22::bigint,
  'each of the 22 closed days is in exactly one recap'
);
select is(
  (select (input ->> 'restDaysPerWeek')::int from inputs where pack_id = '10000000-0000-0000-0000-0000000000f1' and day = '2026-10-11'),
  2,
  'the 8-day week allows 2 rest days where a week allows 1'
);
select is(
  (select (m ->> 'restDaysUsedThisWeek')::int
   from inputs, jsonb_array_elements(input -> 'members') m
   where pack_id = '10000000-0000-0000-0000-0000000000f1' and day = '2026-10-11'
     and m ->> 'userId' = '00000000-0000-0000-0000-0000000000f2'),
  0,
  'Dan''s rest in the old week doesn''t count in the new one'
);
select is(
  (select (input ->> 'restDaysPerWeek')::int from inputs where pack_id = '10000000-0000-0000-0000-0000000000f1' and day = '2026-10-20'),
  1,
  'the weeks after it allow 1 again'
);

-- Monday to Sunday, from Monday Oct 12: the six days in between join the first Sunday week.
select pg_temp.add_pack('10000000-0000-0000-0000-0000000000f2', 'WEEKBBBB', 'monday', 2::smallint, '2026-10-05');
update public.packs set pending_week_start = 'sunday', pending_rest_days_per_week = 2, pending_from = '2026-10-12'
where id = '10000000-0000-0000-0000-0000000000f2';
select pg_temp.close('10000000-0000-0000-0000-0000000000f2', d::date)
from generate_series('2026-10-05'::date, '2026-10-31'::date, interval '1 day') d;

select is(
  pg_temp.recaps('10000000-0000-0000-0000-0000000000f2'),
  '2026-10-05..2026-10-11 (7), 2026-10-12..2026-10-24 (13), 2026-10-25..2026-10-31 (7)',
  'Monday to Sunday: the first Sunday week takes the six days before it'
);
select is(
  (select (input ->> 'restDaysPerWeek')::int from inputs where pack_id = '10000000-0000-0000-0000-0000000000f2' and day = '2026-10-23'),
  4,
  'the 13-day week allows 4 rest days where a week allows 2'
);
select is(
  (select week_start::text || ' from ' || week_changed_on from public.packs where id = '10000000-0000-0000-0000-0000000000f2'),
  'sunday from 2026-10-12',
  'the pack keeps when its weeks changed'
);

-- Changing the settings again during such a longer week: the change waits for its end. Today is
-- one of the days in between whatever weekday the test runs on.
create temp table today as select public.pack_day('UTC') as day;
select pg_temp.add_pack('10000000-0000-0000-0000-0000000000f3', 'WEEKCCCC', 'sunday', 1::smallint, (select day - 30 from today));
update public.packs set
  week_start = case when extract(dow from (select day from today)) = 0 then 'monday' else 'sunday' end::public.week_start,
  week_changed_on = (select case when extract(dow from day) = 0 then day else day - (extract(dow from day)::int + 6) % 7 end from today)
where id = '10000000-0000-0000-0000-0000000000f3';
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.update_pack('10000000-0000-0000-0000-0000000000f3', 'Week test', 3::smallint,
  (select week_start from public.packs where id = '10000000-0000-0000-0000-0000000000f3'));
reset role;
select is(
  (select pending_from from public.packs where id = '10000000-0000-0000-0000-0000000000f3'),
  (select week_changed_on + case when week_start = 'monday' then 8 else 13 end from public.packs where id = '10000000-0000-0000-0000-0000000000f3'),
  'new rest days chosen during a longer week start after it'
);

-- Saving the settings again on the first day of a change, before the day before it has closed
-- (its first hour, or while closes are behind), keeps the change.
select pg_temp.add_pack('10000000-0000-0000-0000-0000000000f4', 'WEEKDDDD', 'sunday', 1::smallint, (select day - 30 from today));
update public.packs set pending_week_start = 'sunday', pending_rest_days_per_week = 2, pending_from = (select day from today)
where id = '10000000-0000-0000-0000-0000000000f4';
set local role authenticated;
select public.update_pack('10000000-0000-0000-0000-0000000000f4', 'Renamed', 2::smallint, 'sunday');
reset role;
select is(
  (select name || ': ' || pending_rest_days_per_week || ' from ' || pending_from from public.packs where id = '10000000-0000-0000-0000-0000000000f4'),
  'Renamed: 2 from ' || (select day from today),
  'renaming the pack then keeps the new rest days from today'
);

-- The rules that pick the week of a day.
select is(
  (select week_from || '..' || week_to from public.week_of('sunday', null, '2026-10-14')),
  '2026-10-11..2026-10-17',
  'a usual week runs from its start day for 7 days'
);
select is(
  (select week_from || '..' || week_to from public.week_of('sunday', '2026-10-12', '2026-10-25')),
  '2026-10-25..2026-10-31',
  'after the longer week, weeks are usual again'
);
select is(
  (select week_from || '..' || week_to from public.week_of('monday', '2026-10-11', '2026-10-04')),
  '2026-09-28..2026-10-04',
  'days before a change keep their usual weeks'
);

select * from finish();
rollback;
