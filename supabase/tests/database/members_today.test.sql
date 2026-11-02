-- What members see of today's close: who has started and the rest days each used this week, and
-- the input of a day before today that still waits for its own close.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e7', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000f7', 'eve@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code) values
  ('10000000-0000-0000-0000-000000000007', 'Walkers', 'walking', 2, 'UTC', 'WALK2345'),
  ('10000000-0000-0000-0000-000000000008', 'Runners', 'running', 1, 'UTC', 'RUNS2345'),
  ('10000000-0000-0000-0000-000000000009', 'Soloists', 'running', 1, 'UTC', 'ALNE2345');
insert into public.critters (pack_id, species) values
  ('10000000-0000-0000-0000-000000000007', 'kit'),
  ('10000000-0000-0000-0000-000000000008', 'kit'),
  ('10000000-0000-0000-0000-000000000009', 'kit');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000d7', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000e7', 'member', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000d7', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000e7', 'member', now()),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d7', 'admin', now() - interval '20 days');

-- Noa fed yesterday; Dan never did, and declared a rest yesterday, which hasn't closed.
create temp table today as select public.pack_day('UTC') as day;
grant select on today to authenticated;
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000d7', (select day - 1 from today));
insert into public.day_passes (pack_id, user_id, day, kind)
select '10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000e7', day - 1, 'rest' from today
where extract(dow from day) <> 0;

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select is(
  (select string_agg((m ->> 'hasStarted') || '/' || (m ->> 'restDaysUsedThisWeek'), ', ' order by m ->> 'userId')
   from jsonb_array_elements(public.members_today('10000000-0000-0000-0000-000000000007') -> 'members') m),
  'true/0, false/' || (select case when extract(dow from day) <> 0 then 1 else 0 end from today),
  'Noa has started; Dan hasn''t, and used a rest this week unless the week starts today'
);
select is(
  (public.members_today('10000000-0000-0000-0000-000000000007') ->> 'restDaysPerWeek')::int, 2,
  'with the rest days the week allows'
);
select is(
  (public.members_today('10000000-0000-0000-0000-000000000007') ->> 'day')::date, (select day from today),
  'and the day it answers for'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f7');
select throws_ok(
  $$ select public.members_today('10000000-0000-0000-0000-000000000007') $$,
  '42501', 'not_a_member', 'someone outside the pack sees nothing'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select is(
  (public.members_today('10000000-0000-0000-0000-000000000007') -> 'dayToClose' ->> 'day')::date,
  (select day - 20 from today),
  'with no result yet, the first day of the pack waits for its close'
);

reset role;
insert into public.day_results (pack_id, day, result, applied, health_before, health_after)
select '10000000-0000-0000-0000-000000000007', d::date, 'neutral', false, 70, 70
from today, generate_series(day - 20, day - 2, interval '1 day') d;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select is(
  (public.members_today('10000000-0000-0000-0000-000000000007') -> 'dayToClose' ->> 'day')::date,
  (select day - 1 from today),
  'after that, the oldest day without a result: yesterday'
);
select is(
  (select string_agg(m ->> 'fedToday', ', ' order by m ->> 'userId')
   from jsonb_array_elements(public.members_today('10000000-0000-0000-0000-000000000007') -> 'dayToClose' -> 'members') m),
  'true, false',
  'with the facts of that day, as its close gets them'
);
select is(
  (select count(*) from jsonb_array_elements(public.members_today('10000000-0000-0000-0000-000000000007') -> 'dayToClose' -> 'members') m
   where m ? 'fedAtMinute'),
  0::bigint,
  'but not the minute anyone fed'
);

reset role;
insert into public.day_results (pack_id, day, result, applied, health_before, health_after)
select '10000000-0000-0000-0000-000000000007', day - 1, 'neutral', false, 70, 70 from today;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select is(
  public.members_today('10000000-0000-0000-0000-000000000007') -> 'dayToClose', 'null'::jsonb,
  'nothing waits once yesterday has its result'
);
select is(
  public.members_today('10000000-0000-0000-0000-000000000008') -> 'dayToClose', 'null'::jsonb,
  'nor in a pack whose days begin today'
);
select is(
  public.members_today('10000000-0000-0000-0000-000000000009') -> 'dayToClose', 'null'::jsonb,
  'nor in a pack of one, whose days don''t close'
);

select * from finish();
rollback;
