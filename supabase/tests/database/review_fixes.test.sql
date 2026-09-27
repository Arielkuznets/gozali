-- The fixes from the Sep 27 code review.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'dan@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

-- Push tokens move with the device.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
select public.register_push_token('ExponentPushToken[phone]', 'ios');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b9');
select lives_ok($$ select public.register_push_token('ExponentPushToken[phone]', 'ios') $$, 'Dan signs in on Noa''s old phone');
reset role;
select is(
  (select user_id from public.push_tokens where token = 'ExponentPushToken[phone]'),
  '00000000-0000-0000-0000-0000000000b9'::uuid,
  'the phone''s token now belongs to Dan, so Noa''s notifications stop going there'
);

-- Profile settings can't break the notification jobs.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
update public.profiles set timezone = 'Mars/Olympus', notification_prefs = '"yes"'
where id = '00000000-0000-0000-0000-0000000000a9';
reset role;
select is(
  (select timezone || ' ' || notification_prefs::text from public.profiles where id = '00000000-0000-0000-0000-0000000000a9'),
  'UTC {}',
  'an unknown time zone becomes UTC and the choices stay an object'
);
select ok(public.wants('{"nudge": "yes"}', 'nudge') and not public.wants('{"nudge": false}', 'nudge'), 'only false turns a notification off');

-- A pack with Noa and Dan, days running.
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000009', 'Runners', 'running', 0, 'UTC', 'REVW2345');
insert into public.critters (pack_id, species, color, status, stage) values ('10000000-0000-0000-0000-000000000009', 'blob', 'peach', 'active', 'kid');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a9', 'admin', '2026-09-01'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b9', 'member', '2026-09-01');

-- Dan fell asleep and woke up on Sep 10, but the close for Sep 8 runs only now.
update public.pack_members set awake_since = '2026-09-10' where user_id = '00000000-0000-0000-0000-0000000000b9';
select is(
  (select m ->> 'membership' from jsonb_array_elements(public.day_close_input('10000000-0000-0000-0000-000000000009', '2026-09-08') -> 'members') m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000000b9'),
  'sleeping',
  'a late close sees Dan as asleep on the days before they woke up'
);
select is(
  (select m ->> 'membership' from jsonb_array_elements(public.day_close_input('10000000-0000-0000-0000-000000000009', '2026-09-10') -> 'members') m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000000b9'),
  'active',
  'and awake from the day they woke'
);

-- A late close doesn't put back to sleep a member who fed on a later day.
insert into public.feeds (pack_id, user_id, day) values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a9', '2026-09-12');
insert into public.day_results (pack_id, day, result, applied, health_before, health_after)
select '10000000-0000-0000-0000-000000000009', d::date, 'neutral', true, 70, 70
from generate_series('2026-09-01'::date, '2026-09-10'::date, interval '1 day') d;
select public.apply_day_result('10000000-0000-0000-0000-000000000009', '2026-09-11', jsonb_build_object(
  'type', 'fail', 'applied', true, 'healthBefore', 70,
  'outcomes', jsonb_build_array(jsonb_build_object('userId', '00000000-0000-0000-0000-0000000000a9', 'outcome', 'missed')),
  'critter', jsonb_build_object('status', 'active', 'health', 62, 'xp', 3, 'stage', 'kid', 'streak', 0, 'marks', '[]'::jsonb),
  'newlySleeping', jsonb_build_array('00000000-0000-0000-0000-0000000000a9'),
  'events', jsonb_build_array(jsonb_build_object('type', 'member_slept', 'userId', '00000000-0000-0000-0000-0000000000a9')),
  'facts', jsonb_build_object('fullHouse', false, 'earlyBird', false, 'nightOwlFeeds', 0)
));
select is(
  (select status::text from public.pack_members where user_id = '00000000-0000-0000-0000-0000000000a9'),
  'active',
  'Noa, who already fed on Sep 12, stays awake'
);
select is(
  (select count(*) from public.notifications where type = 'still_in'), 0::bigint,
  'and gets no "still in?"'
);

-- Notifications about a pack the member left are dropped.
insert into public.notifications (user_id, pack_id, type, send_after)
values ('00000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-000000000009', 'evolution', '2000-01-01');
update public.pack_members set status = 'left', left_at = now() where user_id = '00000000-0000-0000-0000-0000000000b9';
select is(
  (select count(*) from public.claim_notifications('2026-09-27 12:00+00') where user_id = '00000000-0000-0000-0000-0000000000b9'),
  0::bigint,
  'nothing is sent about a pack the member left'
);

-- A removed member still sees their own membership row (so the app hears about the removal),
-- but nothing else of the pack.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b9');
select is(
  (select array_agg(user_id::text || ':' || status::text) from public.pack_members where pack_id = '10000000-0000-0000-0000-000000000009'),
  array['00000000-0000-0000-0000-0000000000b9:left'],
  'Dan sees only their own row, marked left'
);
select is((select count(*) from public.packs where id = '10000000-0000-0000-0000-000000000009'), 0::bigint, 'and not the pack');
reset role;

-- A pack nobody is in stops closing days.
update public.pack_members set status = 'left', left_at = now() where pack_id = '10000000-0000-0000-0000-000000000009';
select is(
  (select count(*) from public.packs_to_close('2026-12-01') where pack_id = '10000000-0000-0000-0000-000000000009'),
  0::bigint,
  'an empty pack is skipped by the day close'
);

-- Five extra posts a day.
update public.pack_members set status = 'active', left_at = null where pack_id = '10000000-0000-0000-0000-000000000009';
insert into storage.objects (bucket_id, name)
select 'feed-photos', '10000000-0000-0000-0000-000000000009/00000000-0000-0000-0000-0000000000a9/' || n || '.jpg' from generate_series(0, 6) n;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
select public.submit_feed('10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009/00000000-0000-0000-0000-0000000000a9/' || n || '.jpg', extra => true)
from generate_series(0, 5) n;
select throws_ok(
  $$ select public.submit_feed('10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009/00000000-0000-0000-0000-0000000000a9/6.jpg', extra => true) $$,
  'P0001', 'too_many_posts', 'after the counted feed, five extra posts a day'
);

-- Housekeeping.
reset role;
insert into public.notifications (user_id, type, status, created_at)
values ('00000000-0000-0000-0000-0000000000a9', 'nudge', 'sent', now() - interval '40 days'),
       ('00000000-0000-0000-0000-0000000000a9', 'nudge', 'pending', now() - interval '40 days');
insert into public.widget_tokens (user_id, token_hash, created_at, last_used_at)
values ('00000000-0000-0000-0000-0000000000a9', 'old', now() - interval '200 days', now() - interval '100 days'),
       ('00000000-0000-0000-0000-0000000000a9', 'fresh', now() - interval '200 days', now() - interval '1 day');
select public.clean_up_old_rows();
select is(
  (select count(*) from public.notifications where created_at < now() - interval '30 days'), 1::bigint,
  'old sent notifications go, pending ones stay'
);
select is(
  (select array_agg(token_hash) from public.widget_tokens where user_id = '00000000-0000-0000-0000-0000000000a9'),
  array['fresh'],
  'widget tokens unused for 90 days go'
);
select is(
  (select count(*) from cron.job where jobname = 'clean-up'), 1::bigint,
  'housekeeping runs daily'
);

select * from finish();
rollback;
