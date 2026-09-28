-- Outages: a gap in close-days' heartbeat, and the pack days that overlap one.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

delete from public.heartbeats;
delete from public.outages;
select is(public.note_heartbeat('close-days', '2026-10-01 10:00+00'), false, 'the first run records no outage');
select is(public.note_heartbeat('close-days', '2026-10-01 10:15+00'), false, 'nor does a run 15 minutes later');
select is(public.note_heartbeat('close-days', '2026-10-01 14:15+00'), true, 'four hours without a run is an outage');
select is(
  (select tstzrange(starts_at, ends_at) from public.outages),
  tstzrange('2026-10-01 10:15+00', '2026-10-01 14:15+00'),
  'from the last run to this one'
);

insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-0000000000af', 'Runners', 'running', 0, 'Asia/Jerusalem', 'DWNX2345');
select ok(public.outage_on('10000000-0000-0000-0000-0000000000af', '2026-10-01'), 'the pack day it fell on can''t fail');
select ok(not public.outage_on('10000000-0000-0000-0000-0000000000af', '2026-10-02'), 'the next day is a normal day');

select * from finish();
rollback;
