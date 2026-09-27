-- Notifications: rows from feeds and the clock, and the rules applied before sending.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Reminders are queued for every pack, so this test runs alone (all rolled back at the end).
delete from public.packs;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b5', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c5', 'maya@test.local');
update public.profiles set timezone = 'Asia/Jerusalem', reminder_time = '20:00', display_name = split_part(
  (select email from auth.users u where u.id = profiles.id), '@', 1
);
insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[noa]', '00000000-0000-0000-0000-0000000000a5', 'ios');

insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000005', 'Runners', 'running', 0, 'Asia/Jerusalem', 'RUNS2345');
insert into public.critters (pack_id, species, color, status, stage, name)
values ('10000000-0000-0000-0000-000000000005', 'spark', 'sky', 'active', 'kid', 'Pixel');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a5', 'admin', now() - interval '10 days'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b5', 'member', now() - interval '9 days'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c5', 'member', now() - interval '9 days');

-- Everyone fed yesterday, so all three have started.
create temp table today as select public.pack_day('Asia/Jerusalem') as day;
insert into public.feeds (pack_id, user_id, day)
select '10000000-0000-0000-0000-000000000005', u, (select day from today) - 1
from unnest(array['00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5']::uuid[]) u;
delete from public.notifications;

-- Friend fed, merged.
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000b5', (select day from today));
select is(
  (select count(*) from public.notifications where type = 'friend_fed'), 2::bigint,
  'a feed tells the two other members'
);
select ok(
  (select bool_and(send_after > now() + interval '9 minutes') from public.notifications where type = 'friend_fed'),
  'after a wait of about 10 minutes, to merge more feeds'
);
select is(
  (select count(*) from public.notifications where type = 'last_one'), 0::bigint,
  'with two still to feed, nobody is last yet'
);
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000c5', (select day from today));
select is(
  (select jsonb_array_length(payload -> 'feeders') from public.notifications
   where type = 'friend_fed' and user_id = '00000000-0000-0000-0000-0000000000a5'),
  2,
  'Noa''s waiting notification now covers both feeds'
);
select is(
  (select user_id from public.notifications where type = 'last_one'),
  '00000000-0000-0000-0000-0000000000a5'::uuid,
  'Noa is the last one'
);

-- Evening reminders: Noa hasn't fed; at 20:05 local time she gets one, once.
select is(
  public.queue_evening_reminders(((select day from today)::timestamp + interval '19 hours 50 minutes') at time zone 'Asia/Jerusalem'),
  0,
  'nothing before the reminder time'
);
select is(
  public.queue_evening_reminders(((select day from today)::timestamp + interval '20 hours 5 minutes') at time zone 'Asia/Jerusalem'),
  1,
  'at 20:05 only the member who hasn''t fed gets a reminder'
);
select is(
  public.queue_evening_reminders(((select day from today)::timestamp + interval '20 hours 10 minutes') at time zone 'Asia/Jerusalem'),
  0,
  'and only once that day'
);
update public.profiles set reminder_time = '02:00' where id = '00000000-0000-0000-0000-0000000000b5';
delete from public.feeds where user_id = '00000000-0000-0000-0000-0000000000b5' and day = (select day from today);
select is(
  public.queue_evening_reminders(((select day from today)::timestamp + interval '1 day 1 hour 10 minutes') at time zone 'Asia/Jerusalem'),
  1,
  'a reminder time after the day ends becomes two hours before the end (01:00)'
);

-- Claiming at 12:00 local: due rows go out with the names and the device tokens.
delete from public.notifications;
insert into public.notifications (user_id, pack_id, type, payload, send_after) values
  ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'friend_fed',
   jsonb_build_object('feeders', jsonb_build_array('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5')), timestamptz '2000-01-01');
create temp table noon as select (((select day from today)::timestamp + interval '12 hours') at time zone 'Asia/Jerusalem') as at;
create temp table claimed as select * from public.claim_notifications((select at from noon));
select is(
  (select array_to_string(names, ',') || ' ' || critter_name || ' ' || array_to_string(tokens, ',') from claimed),
  'dan,maya Pixel ExponentPushToken[noa]',
  'a claimed row carries the feeders'' names, the critter and the devices'
);
select is((select status::text from public.notifications), 'sent', 'and is marked sent');

-- Quiet hours at 23:30: evolution waits for 07:00, friend fed is dropped.
delete from public.notifications;
insert into public.notifications (user_id, pack_id, type, send_after) values
  ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'evolution', timestamptz '2000-01-01'),
  ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'friend_fed', timestamptz '2000-01-01');
select is(
  (select count(*) from public.claim_notifications(((select day from today)::timestamp + interval '23 hours 30 minutes') at time zone 'Asia/Jerusalem')),
  0::bigint,
  'nothing is sent at 23:30'
);
select is(
  (select to_char(send_after at time zone 'Asia/Jerusalem', 'HH24:MI') from public.notifications where type = 'evolution'),
  '07:00',
  'news that still matters waits for 07:00'
);
select is(
  (select status::text from public.notifications where type = 'friend_fed'), 'dropped',
  'the rest is dropped'
);

-- A type the member turned off is dropped.
delete from public.notifications;
update public.profiles set notification_prefs = '{"nudge": false}' where id = '00000000-0000-0000-0000-0000000000a5';
insert into public.notifications (user_id, pack_id, type, send_after)
values ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'nudge', timestamptz '2000-01-01');
select is(
  (select count(*) from public.claim_notifications((select at from noon))), 0::bigint,
  'turned-off types are not sent'
);
update public.profiles set notification_prefs = '{}' where id = '00000000-0000-0000-0000-0000000000a5';

-- The daily cap: after 6, only the evening reminder and "last one" go out.
delete from public.notifications;
insert into public.notifications (user_id, pack_id, type, status, sent_at)
select '00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'pet_state', 'sent', (select at from noon) - interval '1 hour'
from generate_series(1, 6);
insert into public.notifications (user_id, pack_id, type, send_after, day) values
  ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'evolution', timestamptz '2000-01-01', null),
  ('00000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000005', 'evening_reminder', timestamptz '2000-01-01', (select day from today));
select is(
  (select array_agg(type::text) from public.claim_notifications((select at from noon))),
  array['evening_reminder'],
  'past 6 a day only the reminder goes out'
);

-- A reminder for someone who fed in the meantime is dropped.
delete from public.notifications;
insert into public.notifications (user_id, pack_id, type, send_after, day)
values ('00000000-0000-0000-0000-0000000000c5', '10000000-0000-0000-0000-000000000005', 'evening_reminder', timestamptz '2000-01-01', (select day from today));
select is(
  (select count(*) from public.claim_notifications((select at from noon))), 0::bigint,
  'Maya already fed, so her reminder is dropped'
);
select is(
  (select status::text from public.notifications), 'dropped',
  'and marked dropped'
);

select * from finish();
rollback;
