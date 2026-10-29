-- A member who rejoins starts again: feeds from before they left don't make them counted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

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

select * from finish();
rollback;
