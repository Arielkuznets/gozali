-- A notification the push service won't take comes back later each time, and not forever. One that
-- goes back for any other reason spends no try and comes back later the longer it has been around.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- The queue is one for everybody, so this test runs alone (all rolled back at the end).
delete from public.notifications;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'noa@test.local');
update public.profiles set timezone = 'Asia/Jerusalem' where id = '00000000-0000-0000-0000-0000000000e1';

-- Noon tomorrow: daytime for the member, and past every wait in this test. A wait starts at now(),
-- which stays the same for the whole test.
create temp table noon as
select (((now() at time zone 'Asia/Jerusalem')::date + 1)::timestamp + interval '12 hours') at time zone 'Asia/Jerusalem' as at;

-- A run that gets nothing through: what it claims goes back. Returns how much it claimed.
create function pg_temp.refused_run() returns integer language plpgsql as $$
declare
  ids uuid[];
begin
  select array_agg(c.id) into ids from public.claim_notifications((select at from noon)) c;
  perform public.requeue_notifications(ids);
  return coalesce(cardinality(ids), 0);
end;
$$;

insert into public.notifications (user_id, type, payload, send_after)
values ('00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": ["00000000-0000-0000-0000-0000000000e1"]}', timestamptz '2000-01-01');

create temp table runs (try integer, claimed integer, wait_minutes numeric);
do $$
declare
  claimed integer;
begin
  for try in 1..8 loop
    claimed := pg_temp.refused_run();
    insert into runs
    select try, claimed, extract(epoch from n.send_after - now()) / 60 from public.notifications n;
  end loop;
end;
$$;

select is(
  (select array_agg(claimed order by try) from runs),
  array[1, 1, 1, 1, 1, 1, 1, 1],
  'a notification is tried eight times'
);
select is(
  (select array_agg(wait_minutes order by try) from runs),
  array[1, 2, 4, 8, 16, 32, 64, 128]::numeric[],
  'with twice the wait after each refusal, so it doesn''t come back every minute'
);
select is(
  (select status::text from public.notifications), 'pending',
  'a notification that is waiting is still in the queue'
);

select is(pg_temp.refused_run(), 0, 'after the eighth refusal it isn''t sent again');
select is((select status::text from public.notifications), 'dropped', 'it is dropped, so it leaves the queue');

-- Two hundred refused rows are a whole run's worth: what comes after them still goes out.
delete from public.notifications;
insert into public.notifications (user_id, type, payload, send_after)
select '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": ["00000000-0000-0000-0000-0000000000e1"]}', timestamptz '2000-01-01' + make_interval(secs => n)
from generate_series(1, 200) n;
select pg_temp.refused_run();
insert into public.notifications (id, user_id, type, payload, send_after)
values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": ["00000000-0000-0000-0000-0000000000e1"]}', timestamptz '2000-01-02');

create temp table next_run as select c.id from public.claim_notifications((select at from noon)) c;
select is((select count(*) from next_run), 200::bigint, 'the next run still takes a full 200');
select ok(
  exists (select 1 from next_run where id = '50000000-0000-0000-0000-000000000001'),
  'and a fresh notification behind 200 refused ones is among them'
);

-- A run that gets nothing through because the service is down names nothing as refused. The row may
-- be on the phones all the same, so it waits half as long as it has been around, from a minute up to
-- half an hour, and each run below finds it older.
create function pg_temp.down_run(at_time timestamptz) returns integer language plpgsql as $$
declare
  ids uuid[];
begin
  select array_agg(c.id) into ids from public.claim_notifications(at_time) c;
  perform public.requeue_notifications(ids, '{}');
  return coalesce(cardinality(ids), 0);
end;
$$;

delete from public.notifications;
insert into public.notifications (user_id, type, payload, day, send_after)
values ('00000000-0000-0000-0000-0000000000e1', 'daily_summary', '{"serverErrors": 600}', (select at from noon)::date, timestamptz '2000-01-01');

delete from runs;
do $$
declare
  claimed integer;
  ages interval[] := array['0', '1 minute', '4 minutes', '10 minutes', '30 minutes', '59 minutes', '61 minutes', '6 hours', '3 days'];
begin
  for try in 1..9 loop
    update public.notifications set created_at = now() - ages[try];
    claimed := pg_temp.down_run((select at from noon));
    insert into runs
    select try, claimed, extract(epoch from n.send_after - now()) / 60 from public.notifications n;
  end loop;
end;
$$;
select is(
  (select array_agg(claimed order by try) from runs),
  array[1, 1, 1, 1, 1, 1, 1, 1, 1],
  'a service that is down costs no tries: the ninth run still finds the row'
);
select is(
  (select array_agg(wait_minutes order by try) from runs),
  array[1, 1, 2, 5, 15, 29.5, 30, 30, 30]::numeric[],
  'and the row waits half its age, at least a minute and at most half an hour'
);
select is((select attempts from public.notifications), 0, 'it has spent no try');

select is(
  pg_temp.down_run((((select at from noon) at time zone 'Asia/Jerusalem')::date + time '23:30') at time zone 'Asia/Jerusalem'),
  0,
  'through the night nothing goes out'
);
select is(
  (select status::text || ' ' || to_char(send_after at time zone 'Asia/Jerusalem', 'HH24:MI') from public.notifications),
  'pending 07:00',
  'and the summary waits for the morning, however long it has been around'
);
update public.notifications set send_after = timestamptz '2000-01-01';
select is((select count(*) from public.claim_notifications((select at from noon))), 1::bigint, 'it goes out once the service is back');

-- A run can do both: only the rows it names as refused spend a try and wait longer.
delete from public.notifications;
insert into public.notifications (id, user_id, type, payload, send_after, attempts) values
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": ["00000000-0000-0000-0000-0000000000e1"]}', timestamptz '2000-01-01', 3),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": ["00000000-0000-0000-0000-0000000000e1"]}', timestamptz '2000-01-01', 3),
  ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": ["00000000-0000-0000-0000-0000000000e1"]}', timestamptz '2000-01-01', 0);
select public.requeue_notifications(
  array['50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000004']::uuid[],
  array['50000000-0000-0000-0000-000000000002']::uuid[]
);
select is(
  (select attempts || ' ' || round(extract(epoch from send_after - now()) / 60) from public.notifications where id = '50000000-0000-0000-0000-000000000002'),
  '4 8',
  'a refused row spends a try and waits twice as long as the last time'
);
select is(
  (select attempts || ' ' || round(extract(epoch from send_after - now()) / 60) from public.notifications where id = '50000000-0000-0000-0000-000000000003'),
  '3 1',
  'one beside it that was never answered keeps its tries and waits a minute'
);
select is(
  (select attempts || ' ' || round(extract(epoch from send_after - now()) / 60) from public.notifications where id = '50000000-0000-0000-0000-000000000004'),
  '0 1',
  'and so does a fresh one'
);

-- Leaving the second argument out still means every row was refused.
select public.requeue_notifications(array['50000000-0000-0000-0000-000000000004']::uuid[]);
select is((select attempts from public.notifications where id = '50000000-0000-0000-0000-000000000004'), 1, 'with no list of refusals, every row spends a try');
select public.requeue_notifications(array['50000000-0000-0000-0000-000000000004']::uuid[], null);
select is((select attempts from public.notifications where id = '50000000-0000-0000-0000-000000000004'), 2, 'and so with null');

-- Only the function that sends may touch the queue.
set local role authenticated;
select throws_ok(
  'select public.requeue_notifications(array[]::uuid[], array[]::uuid[])',
  '42501',
  null,
  'signed-in users can''t put notifications back'
);
reset role;

select * from finish();
rollback;
