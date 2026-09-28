-- Owner alerts: a push when someone finishes signing up, and the day's summary at 21:00.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

delete from public.notifications;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000c9', 'dan@test.local');
update public.profiles set timezone = 'Asia/Jerusalem'
where id in ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000c9');
insert into public.push_tokens (token, user_id, platform) values
  ('ExponentPushToken[owner]', '00000000-0000-0000-0000-0000000000a9', 'ios');
insert into public.app_owners (user_id) values ('00000000-0000-0000-0000-0000000000a9');

create temp table today as select (now() at time zone 'Asia/Jerusalem')::date as day;
create function pg_temp.at_local(hhmm text) returns timestamptz language sql as $$
  select ((select day from today)::timestamp + hhmm::time) at time zone 'Asia/Jerusalem';
$$;

-- Sign-up alerts.
update public.profiles set display_name = 'Noa', terms_accepted_at = now()
where id = '00000000-0000-0000-0000-0000000000b9';
select is(
  (select count(*) from public.notifications where type = 'new_user' and user_id = '00000000-0000-0000-0000-0000000000a9'),
  1::bigint,
  'finishing the profile setup tells the owner'
);
select is(
  (select payload ->> 'name' from public.notifications where type = 'new_user'),
  'Noa',
  'with the new user''s name'
);
select is(
  (select count(*) from public.notifications where user_id = '00000000-0000-0000-0000-0000000000b9'),
  0::bigint,
  'people who don''t run the app get no alerts'
);
update public.profiles set terms_accepted_at = now(), display_name = 'Noa B'
where id = '00000000-0000-0000-0000-0000000000b9';
select is(
  (select count(*) from public.notifications where type = 'new_user'),
  1::bigint,
  'saving the profile again is not a new sign-up'
);
update public.profiles set terms_accepted_at = null where id = '00000000-0000-0000-0000-0000000000b9';
update public.profiles set terms_accepted_at = now() + interval '1 hour' where id = '00000000-0000-0000-0000-0000000000b9';
select is(
  (select count(*) from public.notifications where type = 'new_user'),
  1::bigint,
  'clearing the terms and accepting them again is not a new sign-up'
);
select ok(
  (select terms_accepted_at <= now() from public.profiles where id = '00000000-0000-0000-0000-0000000000b9'),
  'the first acceptance stays'
);
update public.profiles set display_name = 'Me', terms_accepted_at = now()
where id = '00000000-0000-0000-0000-0000000000a9';
select is(
  (select count(*) from public.notifications where type = 'new_user'),
  1::bigint,
  'the owner is not told about their own sign-up'
);

-- The daily summary.
select is(public.queue_daily_summaries(pg_temp.at_local('20:50')), 0, 'no summary before 21:00');
select is(public.queue_daily_summaries(pg_temp.at_local('21:05')), 1, 'the summary is queued after 21:00');
select is(public.queue_daily_summaries(pg_temp.at_local('21:15')), 0, 'once a day');
select is(
  (select payload from public.notifications where type = 'daily_summary'),
  jsonb_build_object(
    'newUsers', (select count(*) from public.profiles p where p.terms_accepted_at >= pg_temp.at_local('00:00') and p.terms_accepted_at < pg_temp.at_local('00:00') + interval '1 day'),
    'users', (select count(*) from public.profiles p where p.terms_accepted_at is not null),
    'feeders', 0, 'packs', 0, 'reports', 0, 'errors', 0
  ),
  'with the day''s numbers'
);
select ok(
  (select (payload ->> 'newUsers')::int >= 2 from public.notifications where type = 'daily_summary'),
  'counting today''s sign-ups'
);

-- Sending: no cap for the owner alerts, and nothing at night.
update public.notifications set send_after = pg_temp.at_local('11:00') where type = 'new_user';
insert into public.notifications (user_id, type, status, sent_at)
select '00000000-0000-0000-0000-0000000000a9', 'weekly_recap', 'sent', pg_temp.at_local('12:00') - interval '1 minute'
from generate_series(1, 6);
select is(
  (select count(*) from public.claim_notifications(pg_temp.at_local('12:00')) c where c.type = 'new_user'),
  1::bigint,
  'the sign-up alert is sent even after six other pushes that day'
);
insert into public.notifications (user_id, type, payload, send_after)
values ('00000000-0000-0000-0000-0000000000a9', 'new_user', '{"name": "Dan", "number": 3}', pg_temp.at_local('23:00'));
select is(
  (select count(*) from public.claim_notifications(pg_temp.at_local('23:30')) c where c.type = 'new_user'),
  0::bigint,
  'a sign-up late at night is not sent'
);
select is(
  (select send_after from public.notifications where type = 'new_user' and payload ->> 'name' = 'Dan'),
  (((select day from today) + 1)::timestamp + interval '7 hours') at time zone 'Asia/Jerusalem',
  'but waits for 07:00'
);

-- The app can't see who the owners are.
set local role authenticated;
select throws_ok(
  'select * from public.app_owners',
  '42501',
  null,
  'signed-in users can''t read the owners'
);
select throws_ok(
  'select public.queue_daily_summaries()',
  '42501',
  null,
  'or queue summaries'
);
reset role;

select * from finish();
rollback;
