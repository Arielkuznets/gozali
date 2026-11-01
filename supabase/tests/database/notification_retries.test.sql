-- A notification the push service won't take comes back later each time, and not forever.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
values ('00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": []}', timestamptz '2000-01-01');

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
select '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": []}', timestamptz '2000-01-01' + make_interval(secs => n)
from generate_series(1, 200) n;
select pg_temp.refused_run();
insert into public.notifications (id, user_id, type, payload, send_after)
values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1', 'friend_fed', '{"feeders": []}', timestamptz '2000-01-02');

create temp table next_run as select c.id from public.claim_notifications((select at from noon)) c;
select is((select count(*) from next_run), 200::bigint, 'the next run still takes a full 200');
select ok(
  exists (select 1 from next_run where id = '50000000-0000-0000-0000-000000000001'),
  'and a fresh notification behind 200 refused ones is among them'
);

select * from finish();
rollback;
