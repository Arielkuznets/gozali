-- Owner alerts: a push when someone finishes signing up, and the day's summary at 21:00.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
  (select payload - 'failedJobs' - 'serverErrors' - 'packsBehind' - 'fileMB' - 'backupDays' from public.notifications where type = 'daily_summary'),
  jsonb_build_object(
    'newUsers', (select count(*) from public.profiles p where p.terms_accepted_at >= pg_temp.at_local('00:00') and p.terms_accepted_at < pg_temp.at_local('00:00') + interval '1 day'),
    'users', (select count(*) from public.profiles p where p.terms_accepted_at is not null),
    'feeders', 0, 'packs', 0, 'reports', 0, 'errors', 0, 'downHours', 0
  ),
  'with the day''s numbers'
);
select ok(
  (select payload ?& array['failedJobs', 'serverErrors', 'packsBehind', 'fileMB', 'backupDays'] from public.notifications where type = 'daily_summary'),
  'and the server''s health'
);
select ok(
  (select (payload ->> 'newUsers')::int >= 2 from public.notifications where type = 'daily_summary'),
  'counting today''s sign-ups'
);

-- Only runs that ended in failure count, with or without an end time: a restart leaves none. A run
-- still going is not one, and the run that queues the summary is always still going. A later day,
-- so the real jobs' runs can't land in it.
update today set day = day + 1;
insert into cron.job_run_details (jobid, runid, status, start_time, end_time) values
  (0, -1, 'succeeded', pg_temp.at_local('04:00'), pg_temp.at_local('04:00')),
  (0, -2, 'failed', pg_temp.at_local('05:00'), pg_temp.at_local('05:00')),
  (0, -3, 'failed', pg_temp.at_local('06:00'), null),
  (0, -4, 'running', pg_temp.at_local('21:00'), null);
select public.queue_daily_summaries(pg_temp.at_local('21:05'));
select is(
  (select (payload ->> 'failedJobs')::int from public.notifications where type = 'daily_summary' and day = (select day from today)),
  2,
  'a run still in progress is not a failed job'
);
update today set day = day - 1;

-- The size of the stored files, in MB: every bucket counts toward the plan, and a row with no size
-- adds nothing.
create temp table files_before as select coalesce(sum((metadata ->> 'size')::bigint), 0) as bytes from storage.objects;
insert into storage.objects (bucket_id, name, metadata) values
  ('feed-photos', 'owner-alerts/a.jpg', '{"size": 300000000}'),
  ('avatars', 'owner-alerts/b.jpg', '{"size": 200000000}'),
  ('feed-photos', 'owner-alerts/c.jpg', null);
update today set day = day + 2;
select public.queue_daily_summaries(pg_temp.at_local('21:05'));
select is(
  (select (payload ->> 'fileMB')::numeric from public.notifications where type = 'daily_summary' and day = (select day from today)),
  round(((select bytes from files_before) + 500000000) / 1e6),
  'the summary says how much the stored files weigh'
);
update today set day = day - 2;

-- How old the newest backup is, in whole days: a run from the night before is about 23.5 hours old
-- at 21:05, and one night missed adds a day. With none on record the key is there and null.
create function pg_temp.backup_days() returns jsonb language plpgsql as $$
declare
  days jsonb;
begin
  delete from public.notifications where type = 'daily_summary';
  perform public.queue_daily_summaries(pg_temp.at_local('21:05'));
  select payload -> 'backupDays' into days from public.notifications where type = 'daily_summary';
  return days;
end;
$$;
delete from public.heartbeats where job = 'backup';
select is(pg_temp.backup_days(), 'null'::jsonb, 'the summary says when no backup has reported');
insert into public.heartbeats (job, at) values ('backup', pg_temp.at_local('21:05') - interval '23 hours 30 minutes');
select is(pg_temp.backup_days(), '1'::jsonb, 'last night''s backup is a day old');
update public.heartbeats set at = pg_temp.at_local('21:05') - interval '47 hours 30 minutes' where job = 'backup';
select is(pg_temp.backup_days(), '2'::jsonb, 'and a missed night makes it two');

-- Calls from the database to the functions that failed are kept for the summary.
insert into net._http_response (id, status_code, content, created)
values (-1, 503, 'Service is temporarily unavailable', now()), (-2, 200, 'ok', now());
select public.collect_service_errors();
select is(
  (select array_agg(status) from public.service_errors where response_id < 0),
  array[503],
  'calls that didn''t answer 200 are kept'
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

-- When the terms were accepted is the server's to say: the phone's clock can be days off.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d9', 'maya@test.local');
update public.profiles set display_name = 'Dan', terms_accepted_at = now() + interval '2 days'
where id = '00000000-0000-0000-0000-0000000000c9';
select is(
  (select terms_accepted_at from public.profiles where id = '00000000-0000-0000-0000-0000000000c9'),
  now(),
  'a first acceptance from a phone days ahead takes the server''s time'
);
update public.profiles set display_name = 'Maya', terms_accepted_at = now() - interval '2 days'
where id = '00000000-0000-0000-0000-0000000000d9';
select is(
  (select terms_accepted_at from public.profiles where id = '00000000-0000-0000-0000-0000000000d9'),
  now(),
  'and so does one from a phone days behind'
);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'tom@test.local');
update public.profiles set terms_accepted_at = null where id = '00000000-0000-0000-0000-0000000000e9';
select is(
  (select terms_accepted_at from public.profiles where id = '00000000-0000-0000-0000-0000000000e9'),
  null,
  'saving no acceptance leaves the terms unaccepted'
);

select * from finish();
rollback;
