-- Photo retention: 30 days, and recap collage photos 8 weeks after their week.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ae', 'noa@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-0000000000ae', 'Runners', 'running', 0, 'UTC', 'KEEP2345');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-0000000000ae', 'kit');
insert into public.pack_members (pack_id, user_id, role)
values ('10000000-0000-0000-0000-0000000000ae', '00000000-0000-0000-0000-0000000000ae', 'admin');

insert into public.feeds (id, pack_id, user_id, photo_path, day, created_at)
select
  ('20000000-0000-0000-0000-00000000000' || n)::uuid,
  '10000000-0000-0000-0000-0000000000ae',
  '00000000-0000-0000-0000-0000000000ae',
  'p/' || n || '.jpg',
  current_date - age_days,
  now() - make_interval(days => age_days)
from (values (1, 40), (2, 41), (3, 42), (4, 10), (5, 63), (6, 77), (7, 84)) v (n, age_days);
insert into public.weekly_recaps (pack_id, week_start, stats, feed_ids) values
  ('10000000-0000-0000-0000-0000000000ae', current_date - 35, '{}', array['20000000-0000-0000-0000-000000000001']::uuid[]),
  ('10000000-0000-0000-0000-0000000000ae', current_date - 70, '{}', array['20000000-0000-0000-0000-000000000002']::uuid[]),
  -- A week can run 13 or 8 days when a pack changes its first day of the week.
  ('10000000-0000-0000-0000-0000000000ae', current_date - 63, jsonb_build_object('weekEnd', current_date - 51), array['20000000-0000-0000-0000-000000000005']::uuid[]),
  ('10000000-0000-0000-0000-0000000000ae', current_date - 77, jsonb_build_object('weekEnd', current_date - 70), array['20000000-0000-0000-0000-000000000006']::uuid[]),
  ('10000000-0000-0000-0000-0000000000ae', current_date - 84, jsonb_build_object('weekEnd', current_date - 78), array['20000000-0000-0000-0000-000000000007']::uuid[]);

create temp table expired as select feed_id from public.expired_photos();
select ok(
  '20000000-0000-0000-0000-000000000001'::uuid not in (select feed_id from expired),
  'a photo in a recap from last month stays'
);
select ok(
  '20000000-0000-0000-0000-000000000002'::uuid in (select feed_id from expired),
  'a photo in a recap that ended more than 8 weeks ago goes'
);
select ok(
  '20000000-0000-0000-0000-000000000003'::uuid in (select feed_id from expired),
  'a photo in no recap goes after 30 days'
);
select ok(
  '20000000-0000-0000-0000-000000000004'::uuid not in (select feed_id from expired),
  'a photo from 10 days ago stays'
);
select ok(
  '20000000-0000-0000-0000-000000000005'::uuid not in (select feed_id from expired),
  'a 13-day week: the photo outlasts 8 weeks counted from the week''s seventh day'
);
select ok(
  '20000000-0000-0000-0000-000000000005'::uuid not in (select e.feed_id from public.expired_photos(now() + interval '5 days') e),
  'a 13-day week: the last day of the 8 weeks still has the photo'
);
select ok(
  '20000000-0000-0000-0000-000000000005'::uuid in (select e.feed_id from public.expired_photos(now() + interval '6 days') e),
  'a 13-day week: the photo goes the day after'
);
select ok(
  '20000000-0000-0000-0000-000000000006'::uuid not in (select e.feed_id from public.expired_photos(now() - interval '14 days') e),
  'an 8-day week: the last day of the 8 weeks still has the photo'
);
select ok(
  '20000000-0000-0000-0000-000000000006'::uuid in (select e.feed_id from public.expired_photos(now() - interval '13 days') e),
  'an 8-day week: the photo goes the day after'
);
select ok(
  '20000000-0000-0000-0000-000000000007'::uuid not in (select e.feed_id from public.expired_photos(now() - interval '22 days') e),
  'a 7-day week: the last day of the 8 weeks still has the photo'
);
select ok(
  '20000000-0000-0000-0000-000000000007'::uuid in (select e.feed_id from public.expired_photos(now() - interval '21 days') e),
  'a 7-day week: the photo goes the day after'
);

select * from finish();
rollback;
