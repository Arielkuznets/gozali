-- Who fed in the caller's packs. A block or a hidden photo changes what can be seen of a feed, not
-- whether it counted.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c9', 'maya@test.local'),
  ('00000000-0000-0000-0000-0000000000d9', 'lea@test.local'),
  ('00000000-0000-0000-0000-0000000000e9', 'eve@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code) values
  ('10000000-0000-0000-0000-000000000009', 'Walkers', 'walking', 2, 'UTC', 'WALK2349'),
  ('10000000-0000-0000-0000-000000000019', 'Readers', 'reading', 2, 'UTC', 'READ2349');
insert into public.pack_members (pack_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a9', 'admin'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000b9', 'member'),
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000c9', 'member'),
  ('10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-0000000000e9', 'admin'),
  ('10000000-0000-0000-0000-000000000019', '00000000-0000-0000-0000-0000000000b9', 'member');
insert into public.pack_members (pack_id, user_id, role, status, left_at) values
  ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000d9', 'member', 'left', now());

insert into public.blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9');

create temp table today as select (now() at time zone 'utc')::date as day;
grant select on today to authenticated;

-- Dan, whom Noa blocked, fed and posted an extra; Maya's photo was hidden.
insert into public.feeds (pack_id, user_id, day, is_extra, photo_path, caption, hidden_at)
select '10000000-0000-0000-0000-000000000009'::uuid, member::uuid, today.day, extra, photo, note, hidden
from today, (values
  ('00000000-0000-0000-0000-0000000000b9', false, 'walkers/dan/1.jpg', 'Long way home', null::timestamptz),
  ('00000000-0000-0000-0000-0000000000b9', true, 'walkers/dan/2.jpg', 'And back', null),
  ('00000000-0000-0000-0000-0000000000c9', false, 'walkers/maya/1.jpg', 'Reported', now())
) f (member, extra, photo, note, hidden);
-- Noa's own feeds, two and three days back.
insert into public.feeds (pack_id, user_id, day)
select '10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a9', day - back
from today, unnest(array[2, 3]) back;
-- The other pack, which Dan is in and Noa isn't.
insert into public.feeds (pack_id, user_id, day)
select '10000000-0000-0000-0000-000000000019', member::uuid, day
from today, unnest(array['00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000e9']) member;

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
select is(
  (select count(*) from public.feeds where user_id = '00000000-0000-0000-0000-0000000000b9'), 0::bigint,
  'the table keeps a blocked member''s feeds from the person who blocked them'
);
select is(
  (select count(*) from public.feeds where user_id = '00000000-0000-0000-0000-0000000000c9'), 0::bigint,
  'and a hidden feed from everyone'
);
select is(
  (select day from public.counted_feeds() where user_id = '00000000-0000-0000-0000-0000000000b9'),
  (select day from today),
  'a member still counts for the person who blocked them, once, without the extra post'
);
select is(
  (select day from public.counted_feeds() where user_id = '00000000-0000-0000-0000-0000000000c9'),
  (select day from today),
  'a feed still counts after its photo is hidden'
);
select is(
  (select count(*) from public.counted_feeds() where pack_id <> '10000000-0000-0000-0000-000000000009'), 0::bigint,
  'nothing comes from a pack the caller isn''t in'
);
select ok(
  (select day - 2 from today) in (select day from public.counted_feeds() where user_id = '00000000-0000-0000-0000-0000000000a9'),
  'two days back covers today in every time zone'
);
select is(
  (select count(*) from public.counted_feeds() where user_id = '00000000-0000-0000-0000-0000000000a9'), 1::bigint,
  'older days stay out'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b9');
select is(
  (select count(*) from public.counted_feeds() where user_id = '00000000-0000-0000-0000-0000000000a9'), 1::bigint,
  'the person blocked sees the other member''s feed as ever'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c9');
select is(
  (select count(*) from public.feeds where user_id = '00000000-0000-0000-0000-0000000000c9'), 0::bigint,
  'the author can''t read their hidden feed either'
);
select is(
  (select day from public.counted_feeds() where user_id = '00000000-0000-0000-0000-0000000000c9'),
  (select day from today),
  'but it still counts for them'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d9');
select is((select count(*) from public.counted_feeds()), 0::bigint, 'someone who left the pack gets nothing');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e9');
select is(
  (select array_agg(distinct pack_id) from public.counted_feeds()), array['10000000-0000-0000-0000-000000000019'::uuid],
  'a member of the other pack gets only that pack'
);

select is(
  pg_get_function_result('public.counted_feeds()'::regprocedure),
  'TABLE(pack_id uuid, user_id uuid, day date)',
  'who and when is all that comes out: no photo, no caption'
);

reset role;
set local role anon;
select throws_ok(
  $$ select * from public.counted_feeds() $$,
  '42501', 'permission denied for function counted_feeds', 'signed out, nothing'
);

select * from finish();
rollback;
