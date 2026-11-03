-- A member who rejoins starts again: feeds from before they left don't make them counted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

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

-- Everyone left a new pack days ago, after feeding. Each one back starts over, not only the first:
-- none of them answers for the time nobody was there, or counts a feed from before.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'maya@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'lior@test.local'),
  ('00000000-0000-0000-0000-0000000000c9', 'yael@test.local');
create function pg_temp.emptied_pack(pack uuid, code text, members uuid[]) returns void language sql as $$
  insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
  values (pack, 'Climbers', 'running', 0, 'UTC', code);
  insert into public.critters (pack_id, species) values (pack, 'kit');
  insert into public.pack_members (pack_id, user_id, role, status, joined_at, left_at)
  select pack, m.user_id, 'member', 'left', now() - interval '5 days' + m.position * interval '1 minute',
    now() - interval '4 days'
  from unnest(members) with ordinality as m (user_id, position);
  insert into public.feeds (pack_id, user_id, day, created_at)
  select pack, m.user_id, public.pack_day('UTC') - 5, now() - interval '5 days' + interval '1 hour'
  from unnest(members) as m (user_id);
$$;
create function pg_temp.returns_to(code text, member uuid) returns void language sql as $$
  select pg_temp.act_as(member);
  set local role authenticated;
  select public.join_pack(code);
  reset role;
$$;
create function pg_temp.leaves(pack uuid, member uuid) returns void language sql as $$
  select pg_temp.act_as(member);
  set local role authenticated;
  select public.leave_pack(pack);
  reset role;
$$;
create function pg_temp.standing(pack uuid, member uuid, pack_date date) returns text language sql as $$
  select (m ->> 'membership') || '/' || (m ->> 'hasStarted') || '/' || (m ->> 'fedToday')
  from jsonb_array_elements(public.day_close_input(pack, pack_date) -> 'members') m
  where m ->> 'userId' = member::text;
$$;
create function pg_temp.joined_on(pack uuid, member uuid) returns date language sql as $$
  select public.pack_day('UTC', m.joined_at) from public.pack_members m where m.pack_id = pack and m.user_id = member;
$$;

select pg_temp.emptied_pack(
  '10000000-0000-0000-0000-000000000028', 'CLMB3456',
  array['00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9']::uuid[]
);
select pg_temp.returns_to('CLMB3456', '00000000-0000-0000-0000-0000000000a9');
select pg_temp.returns_to('CLMB3456', '00000000-0000-0000-0000-0000000000b9');
select is(
  pg_temp.joined_on('10000000-0000-0000-0000-000000000028', '00000000-0000-0000-0000-0000000000b9'),
  (select day from today),
  'the second one back to an empty pack counts from that day too'
);
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000028', '00000000-0000-0000-0000-0000000000b9', (select day from today)
  ),
  'active/false/false',
  'and hasn''t started, so the day can''t charge them a miss'
);

-- With a third member the old first day would stay if anyone kept their time.
select pg_temp.emptied_pack(
  '10000000-0000-0000-0000-000000000128', 'CLMC3456',
  array['00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9',
        '00000000-0000-0000-0000-0000000000c9']::uuid[]
);
select pg_temp.returns_to('CLMC3456', '00000000-0000-0000-0000-0000000000a9');
select pg_temp.returns_to('CLMC3456', '00000000-0000-0000-0000-0000000000b9');
select is(
  public.pack_first_day('10000000-0000-0000-0000-000000000128'), (select day from today),
  'a pack of three starts from that day as well'
);
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000128', '00000000-0000-0000-0000-0000000000b9', (select day - 3 from today)
  ),
  null,
  'and the days nobody was there don''t count them'
);

-- Maya and Lior fed and left days ago. Lior is back today, and Maya the same day.
select pg_temp.emptied_pack(
  '10000000-0000-0000-0000-000000000228', 'CLMD3456',
  array['00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9']::uuid[]
);
select pg_temp.returns_to('CLMD3456', '00000000-0000-0000-0000-0000000000b9');
select pg_temp.returns_to('CLMD3456', '00000000-0000-0000-0000-0000000000a9');
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000228', '00000000-0000-0000-0000-0000000000a9', (select day from today)
  ),
  'active/false/false',
  'someone who left before the first day isn''t charged for it'
);

-- A pack with nobody in it keeps its photos for weeks, and nobody is there to see who comes in.
-- Only someone who was in it can come back. To anyone else its code is one no pack has.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ca', 'ori@test.local');
select pg_temp.emptied_pack(
  '10000000-0000-0000-0000-000000000328', 'CLME3456', array['00000000-0000-0000-0000-0000000000ca']::uuid[]
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c9');
set local role authenticated;
select is(
  (select count(*) from public.pack_preview('CLME3456')), 0::bigint,
  'someone who was never in an emptied pack can''t see it'
);
select is(public.join_pack('CLME3456'), null, 'or join it');
reset role;
select is(
  (select count(*) from public.pack_members
   where pack_id = '10000000-0000-0000-0000-000000000328' and user_id = '00000000-0000-0000-0000-0000000000c9'),
  0::bigint,
  'so they get no membership'
);
select is(
  (select count(*) from public.code_misses where user_id = '00000000-0000-0000-0000-0000000000c9'),
  2::bigint,
  'and both count as misses, as for a code no pack has'
);

-- At the limit of packs a refusal would tell the code is real.
insert into public.pack_members (pack_id, user_id)
select p, '00000000-0000-0000-0000-0000000000c9'
from unnest(array[
  '10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000028'
]::uuid[]) p;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c9');
set local role authenticated;
select is(public.join_pack('CLME3456'), null, 'someone at the limit of packs gets the same answer');
reset role;
delete from public.pack_members
where user_id = '00000000-0000-0000-0000-0000000000c9'
  and pack_id in ('10000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000028');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
set local role authenticated;
select is(
  (select member_count from public.pack_preview('CLME3456')), 0,
  'someone who was in it still sees it'
);
reset role;
select pg_temp.returns_to('CLME3456', '00000000-0000-0000-0000-0000000000ca');
select is(
  (select role || '/' || status from public.pack_members
   where pack_id = '10000000-0000-0000-0000-000000000328' and user_id = '00000000-0000-0000-0000-0000000000ca'),
  'admin/active',
  'and comes back as its admin'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c9');
set local role authenticated;
select is(
  public.join_pack('CLME3456'), '10000000-0000-0000-0000-000000000328'::uuid,
  'with someone there the code works for anyone again'
);
reset role;

-- Being the last one out doesn't undo a removal.
select pg_temp.emptied_pack(
  '10000000-0000-0000-0000-000000000428', 'CLMF3456', array['00000000-0000-0000-0000-0000000000ca']::uuid[]
);
update public.pack_members set removed_at = now() where pack_id = '10000000-0000-0000-0000-000000000428';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ca');
set local role authenticated;
select throws_ok(
  $$ select public.join_pack('CLMF3456') $$,
  'P0001', 'removed_from_pack', 'a member the admin removed stays out of an emptied pack'
);
select throws_ok(
  $$ select * from public.pack_preview('CLMF3456') $$,
  'P0001', 'removed_from_pack', 'and doesn''t see it either'
);
reset role;

-- Yesterday waits for its close, in the time between the end of a day and its close. Roni and Sam
-- fed on it. Sam leaves and rejoins before it closes: the feed still counts, so an egg still hatches.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d9', 'eli@test.local'),
  ('00000000-0000-0000-0000-0000000000e9', 'dina@test.local'),
  ('00000000-0000-0000-0000-0000000000f9', 'gal@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000038', 'Rowers', 'running', 0, 'UTC', 'RWRS3456');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000038', 'kit');
insert into public.pack_members (pack_id, user_id, role, joined_at)
select '10000000-0000-0000-0000-000000000038', u, 'member', now() - interval '2 days'
from unnest(array[
  '00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000c8',
  '00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000e9',
  '00000000-0000-0000-0000-0000000000f9'
]::uuid[]) u;
create temp table quiet_day as select jsonb_build_object(
  'type', 'neutral', 'applied', false, 'healthBefore', 70, 'coins', 0,
  'critter', jsonb_build_object('status', 'egg', 'health', 70, 'xp', 0, 'stage', 'egg', 'streak', 0, 'marks', '[]'::jsonb),
  'outcomes', '[]'::jsonb, 'newlySleeping', '[]'::jsonb, 'events', '[]'::jsonb,
  'facts', jsonb_build_object('earlyBird', false, 'fullHouse', false, 'nightOwlFeeds', 0)
) as body;
select public.apply_day_result(
  '10000000-0000-0000-0000-000000000038', (select day - 2 from today), (select body from quiet_day)
);
insert into public.feeds (pack_id, user_id, day, created_at)
select '10000000-0000-0000-0000-000000000038', u, (select day - 1 from today), now() - interval '1 day'
from unnest(array['00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000c8']::uuid[]) u;

select pg_temp.leaves('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000c8');
select pg_temp.returns_to('RWRS3456', '00000000-0000-0000-0000-0000000000c8');
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000c8', (select day - 1 from today)
  ),
  'active/true/true',
  'a rejoin before an ended day closes keeps the feed on it'
);
select is(
  pg_temp.joined_on('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000c8'),
  (select day - 2 from today),
  'and the time they joined'
);

-- Sam left during that day, after feeding: the same.
update public.pack_members set status = 'left', left_at = public.day_closes_at('UTC', (select day - 1 from today)) - interval '2 hours'
where pack_id = '10000000-0000-0000-0000-000000000038' and user_id = '00000000-0000-0000-0000-0000000000c8';
select pg_temp.returns_to('RWRS3456', '00000000-0000-0000-0000-0000000000c8');
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000c8', (select day - 1 from today)
  ),
  'active/true/true',
  'so does one by a member who left during that day, after feeding'
);

-- Eli left that day without feeding: the day doesn't count him, and coming back doesn't either.
update public.pack_members set status = 'left', left_at = public.day_closes_at('UTC', (select day - 1 from today)) - interval '2 hours'
where pack_id = '10000000-0000-0000-0000-000000000038' and user_id = '00000000-0000-0000-0000-0000000000d9';
select pg_temp.returns_to('RWRS3456', '00000000-0000-0000-0000-0000000000d9');
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000d9', (select day - 1 from today)
  ),
  null,
  'a member who left that day without feeding isn''t charged for it'
);
select is(
  pg_temp.joined_on('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000d9'),
  (select day from today),
  'and starts again from today'
);

-- Dina is asleep. A rejoin makes a member active, so a kept time would turn her sleep into a miss.
update public.pack_members set status = 'sleeping'
where pack_id = '10000000-0000-0000-0000-000000000038' and user_id = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.leaves('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000e9');
select pg_temp.returns_to('RWRS3456', '00000000-0000-0000-0000-0000000000e9');
select is(
  pg_temp.standing(
    '10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000e9', (select day - 1 from today)
  ),
  null,
  'nor is a member who was asleep'
);

-- Gal left before that day began.
update public.pack_members set status = 'left', left_at = public.day_closes_at('UTC', (select day - 2 from today)) - interval '2 hours'
where pack_id = '10000000-0000-0000-0000-000000000038' and user_id = '00000000-0000-0000-0000-0000000000f9';
select pg_temp.returns_to('RWRS3456', '00000000-0000-0000-0000-0000000000f9');
select is(
  pg_temp.joined_on('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000f9'),
  (select day from today),
  'someone who left before that day starts again'
);

-- Once the day has closed there is nothing left to keep.
select public.apply_day_result(
  '10000000-0000-0000-0000-000000000038', (select day - 1 from today), (select body from quiet_day)
);
select pg_temp.leaves('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000c8');
select pg_temp.returns_to('RWRS3456', '00000000-0000-0000-0000-0000000000c8');
select is(
  pg_temp.joined_on('10000000-0000-0000-0000-000000000038', '00000000-0000-0000-0000-0000000000c8'),
  (select day from today),
  'and a rejoin after the close counts from today'
);

select * from finish();
rollback;
