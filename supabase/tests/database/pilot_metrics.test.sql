-- The pilot's numbers (spec sections 1 and 15).
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Only this test's packs, whatever else the local database holds.
delete from public.packs;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'maya@test.local');

-- A pack from 20 days ago where Noa and Dan fed 3 times this week, and a new pack Dan opened
-- 5 days after joining Noa's, where only Dan feeds.
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code, created_at) values
  ('10000000-0000-0000-0000-0000000000e1', 'Gym squad', 'gym', 1, 'UTC', 'PACKAAA2', now() - interval '20 days'),
  ('10000000-0000-0000-0000-0000000000e2', 'Readers', 'reading', 0, 'UTC', 'PACKAAA3', now() - interval '15 days');
insert into public.critters (pack_id, species) values
  ('10000000-0000-0000-0000-0000000000e1', 'kit'),
  ('10000000-0000-0000-0000-0000000000e2', 'hoot');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'member', now() - interval '19 days'),
  ('10000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'member', now() - interval '19 days'),
  ('10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', 'admin', now() - interval '15 days'),
  ('10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3', 'member', now() - interval '14 days');
insert into public.feeds (pack_id, user_id, day, created_at)
select '10000000-0000-0000-0000-0000000000e1', u, (now() - n * interval '1 day')::date, now() - n * interval '1 day'
from unnest(array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[]) u, generate_series(1, 3) n;
insert into public.feeds (pack_id, user_id, day, created_at)
select '10000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', (now() - n * interval '1 day')::date, now() - n * interval '1 day'
from generate_series(1, 4) n;

select is((public.pilot_metrics() ->> 'packs')::int, 2, 'two packs');
select is((public.pilot_metrics() ->> 'activeAfter14Days')::int, 1, 'two of three steady members keep a pack active; one of two does not');
select is((public.pilot_metrics() ->> 'averageSize')::numeric, 2.5, 'packs of 3 and 2');
select is((public.pilot_metrics() ->> 'invitedUsers')::int, 2, 'Dan and Maya were invited');
select is((public.pilot_metrics() ->> 'invitedWhoOpenedAPack')::int, 1, 'Dan opened a pack of his own within 30 days');

set local role authenticated;
select throws_ok($$ select public.pilot_metrics() $$, '42501', null, 'members can''t read the pilot numbers');

select * from finish();
rollback;
