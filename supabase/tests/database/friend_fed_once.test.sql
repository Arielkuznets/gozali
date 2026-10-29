-- "Friend fed" names a feeder once, even with two counted feeds while the notice waits.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d9', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e9', 'dan@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000009', 'Walkers', 'walking', 0, 'UTC', 'WALK4567');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000009', 'kit');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d9', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000e9', 'member', now() - interval '20 days');

-- Noa feeds just before 03:00 for yesterday and just after for today, within one wait.
insert into public.feeds (pack_id, user_id, day)
select '10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d9', public.pack_day('UTC') - d
from (values (1), (0)) v (d);

select is(
  (select payload -> 'feeders' from public.notifications
   where type = 'friend_fed' and user_id = '00000000-0000-0000-0000-0000000000e9'),
  '["00000000-0000-0000-0000-0000000000d9"]'::jsonb,
  'Dan hears that Noa fed, once'
);

select * from finish();
rollback;
