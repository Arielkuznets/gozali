-- "Friend fed" names a feeder once, even with two counted feeds while the notice waits, and only
-- feeders still there. A notice Expo refused takes in no more feeds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

-- Tal and Eve feed, and accounts can go during the wait, taking their feeds along.
delete from public.notifications;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f9', 'eve@test.local'),
  ('00000000-0000-0000-0000-0000000000a9', 'tal@test.local');
update public.profiles set display_name = 'Eve' where id = '00000000-0000-0000-0000-0000000000f9';
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000f9', 'member', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a9', 'member', now() - interval '20 days');
create temp table noon as select (public.pack_day('UTC')::timestamp + interval '12 hours') at time zone 'UTC' as at;

insert into public.feeds (pack_id, user_id, day) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000f9', public.pack_day('UTC')),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a9', public.pack_day('UTC'));
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a9';
update public.notifications set send_after = timestamptz '2000-01-01';
select is(
  (select names from public.claim_notifications((select at from noon)) where user_id = '00000000-0000-0000-0000-0000000000e9'),
  array['Eve'],
  'with one of two feeders gone, the notice names the one still there'
);

delete from public.notifications;
insert into public.feeds (pack_id, user_id, day) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000e9', public.pack_day('UTC'));
delete from public.notifications where user_id <> '00000000-0000-0000-0000-0000000000d9';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e9';
update public.notifications set send_after = timestamptz '2000-01-01';
select is(
  (select count(*) from public.claim_notifications((select at from noon))), 0::bigint,
  'with every feeder gone, nobody hears about a feed that is gone too'
);
select is((select status::text from public.notifications), 'dropped', 'and the notice leaves the queue');

-- Noa has a notice about Eve that Expo refused. Maya's feed must not depend on it.
delete from public.notifications;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b9', 'maya@test.local'),
  ('00000000-0000-0000-0000-0000000000c9', 'omer@test.local');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b9', 'member', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c9', 'member', now() - interval '20 days');
insert into public.notifications (id, user_id, pack_id, type, payload, send_after) values (
  '50000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d9', '10000000-0000-0000-0000-000000000009', 'friend_fed',
  jsonb_build_object('feeders', jsonb_build_array('00000000-0000-0000-0000-0000000000f9')), timestamptz '2000-01-01'
);
select public.requeue_notifications(array['50000000-0000-0000-0000-000000000009']::uuid[]);
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b9', public.pack_day('UTC'));

select is(
  (select payload -> 'feeders' from public.notifications where id = '50000000-0000-0000-0000-000000000009'),
  '["00000000-0000-0000-0000-0000000000f9"]'::jsonb,
  'a notice Expo refused takes in no new feed'
);
select is(
  (select payload -> 'feeders' from public.notifications
   where type = 'friend_fed' and status = 'pending' and user_id = '00000000-0000-0000-0000-0000000000d9'
     and id <> '50000000-0000-0000-0000-000000000009'),
  '["00000000-0000-0000-0000-0000000000b9"]'::jsonb,
  'the feed gets a notice of its own'
);
select is(
  (select send_after from public.notifications
   where type = 'friend_fed' and status = 'pending' and user_id = '00000000-0000-0000-0000-0000000000d9'
     and id <> '50000000-0000-0000-0000-000000000009'),
  now() + interval '10 minutes',
  'with its own ten minutes to gather others'
);

-- A notice held up by an outage spent no try and still gathers feeds.
delete from public.notifications;
insert into public.notifications (id, user_id, pack_id, type, payload, send_after) values (
  '50000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d9', '10000000-0000-0000-0000-000000000009', 'friend_fed',
  jsonb_build_object('feeders', jsonb_build_array('00000000-0000-0000-0000-0000000000f9')), timestamptz '2000-01-01'
);
select public.requeue_notifications(array['50000000-0000-0000-0000-000000000009']::uuid[], '{}');
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c9', public.pack_day('UTC'));
select is(
  (select payload -> 'feeders' from public.notifications
   where type = 'friend_fed' and status = 'pending' and user_id = '00000000-0000-0000-0000-0000000000d9'),
  '["00000000-0000-0000-0000-0000000000f9", "00000000-0000-0000-0000-0000000000c9"]'::jsonb,
  'a notice held up by an outage still gathers feeds'
);

select * from finish();
rollback;
