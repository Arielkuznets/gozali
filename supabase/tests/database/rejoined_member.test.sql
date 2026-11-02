-- A member who rejoins starts again: feeds from before they left don't make them counted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d8', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e8', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000f8', 'eve@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000008', 'Walkers', 'walking', 0, 'UTC', 'WALK3456');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000008', 'kit');
-- Noa and Eve have been in for weeks. Dan was too, left, and joined again just now.
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000d8', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000f8', 'member', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000e8', 'member', now());

create temp table today as select public.pack_day('UTC') as day;
-- Eve and Dan fed ten days ago, Dan before he left.
insert into public.feeds (pack_id, user_id, day, created_at)
select '10000000-0000-0000-0000-000000000008', u, (select day - 10 from today), now() - interval '10 days'
from unnest(array['00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000e8']::uuid[]) u;

select is(
  (select string_agg((m ->> 'hasStarted'), ', ' order by m ->> 'userId')
   from jsonb_array_elements(
     public.day_close_input('10000000-0000-0000-0000-000000000008', (select day from today)) -> 'members'
   ) m),
  'false, false, true',
  'Dan''s feed from before he left doesn''t count as a start (nor has Noa started); Eve has started'
);

-- Noa feeds today. Of those who started, only Eve hasn't fed: she is the last one, and Dan, who
-- hasn't fed since he came back, doesn't stand in the way.
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000d8', (select day from today));
select is(
  (select count(*) from public.notifications where type = 'last_one' and pack_id = '10000000-0000-0000-0000-000000000008'
     and user_id = '00000000-0000-0000-0000-0000000000f8'),
  1::bigint,
  'Eve hears she is the last one'
);

-- Once Dan feeds after coming back, he counts again.
insert into public.feeds (pack_id, user_id, day, created_at)
values ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000e8', (select day from today), now() + interval '1 minute');
select is(
  (select m ->> 'hasStarted'
   from jsonb_array_elements(
     public.day_close_input('10000000-0000-0000-0000-000000000008', (select day from today)) -> 'members'
   ) m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000000e8'),
  'true',
  'a feed since he rejoined starts him again'
);

-- Tal feeds this morning, leaves, and joins again the same day: the feed still counts for today.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a8', 'tal@test.local');
insert into public.pack_members (pack_id, user_id, role, joined_at)
values ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a8', 'member', now() - interval '20 days');
insert into public.feeds (pack_id, user_id, day, created_at)
values ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a8', (select day from today), now() - interval '1 minute');
create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a8');
select public.leave_pack('10000000-0000-0000-0000-000000000008');
select public.join_pack('WALK3456');
reset role;
select is(
  (select (m ->> 'hasStarted') || '/' || (m ->> 'fedToday')
   from jsonb_array_elements(
     public.day_close_input('10000000-0000-0000-0000-000000000008', (select day from today)) -> 'members'
   ) m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000000a8'),
  'true/true',
  'a feed earlier on the day of the rejoin still counts'
);

-- Nothing has closed in a new pack yet. Roni and Sam joined and fed yesterday, and Sam leaves and
-- rejoins before that first day closes: the pack's first day stays, and so does Sam's feed.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b8', 'roni@test.local'),
  ('00000000-0000-0000-0000-0000000000c8', 'sam@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000018', 'Swimmers', 'running', 0, 'UTC', 'SWAM3456');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000018', 'kit');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-0000000000b8', 'admin', now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-0000000000c8', 'member', now() - interval '1 day');
insert into public.feeds (pack_id, user_id, day, created_at)
select '10000000-0000-0000-0000-000000000018', u, (select day - 1 from today), now() - interval '1 day'
from unnest(array['00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000c8']::uuid[]) u;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c8');
select public.leave_pack('10000000-0000-0000-0000-000000000018');
select public.join_pack('SWAM3456');
reset role;
select is(
  public.pack_first_day('10000000-0000-0000-0000-000000000018'), (select day - 1 from today),
  'a rejoin before the first close leaves the pack''s first day where it was'
);
select is(
  (select (m ->> 'membership') || '/' || (m ->> 'hasStarted') || '/' || (m ->> 'fedToday')
   from jsonb_array_elements(
     public.day_close_input('10000000-0000-0000-0000-000000000018', (select day - 1 from today)) -> 'members'
   ) m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000000c8'),
  'active/true/true',
  'and that day still counts the feed from before leaving'
);

-- Once a day has closed, a rejoin starts again as usual.
select public.apply_day_result(
  '10000000-0000-0000-0000-000000000018', (select day - 1 from today),
  jsonb_build_object(
    'type', 'neutral', 'applied', false, 'healthBefore', 70, 'coins', 0,
    'critter', jsonb_build_object('status', 'egg', 'health', 70, 'xp', 0, 'stage', 'egg', 'streak', 0, 'marks', '[]'::jsonb),
    'outcomes', '[]'::jsonb, 'newlySleeping', '[]'::jsonb, 'events', '[]'::jsonb,
    'facts', jsonb_build_object('earlyBird', false, 'fullHouse', false, 'nightOwlFeeds', 0)
  )
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c8');
select public.leave_pack('10000000-0000-0000-0000-000000000018');
select public.join_pack('SWAM3456');
reset role;
select is(
  (select public.pack_day('UTC', joined_at) from public.pack_members
   where pack_id = '10000000-0000-0000-0000-000000000018' and user_id = '00000000-0000-0000-0000-0000000000c8'),
  (select day from today),
  'a rejoin after a close counts from that day'
);

-- Everyone left a new pack days ago. Whoever comes back starts it over: the days nobody was there
-- don't close first, each one a miss for a member who fed once.
delete from public.day_results where pack_id = '10000000-0000-0000-0000-000000000018';
update public.pack_members set status = 'left', left_at = now() - interval '5 days', joined_at = now() - interval '9 days'
where pack_id = '10000000-0000-0000-0000-000000000018';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b8');
select public.join_pack('SWAM3456');
reset role;
select is(
  public.pack_first_day('10000000-0000-0000-0000-000000000018'), (select day from today),
  'someone coming back to an empty pack starts its days from that day'
);

select * from finish();
rollback;
