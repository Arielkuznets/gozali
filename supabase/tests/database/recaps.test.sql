-- The weekly recap, created when the last day of a pack's week closes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Only this test's pack, whatever else the local database holds.
delete from public.weekly_recaps;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a6', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b6', 'dan@test.local');
insert into public.packs (id, name, category, rest_days_per_week, week_start, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000006', 'Readers', 'reading', 1, 'sunday', 'Asia/Jerusalem', 'READ2345');
insert into public.critters (pack_id, species, status, stage, health, streak, name)
values ('10000000-0000-0000-0000-000000000006', 'hoot', 'active', 'kid', 81, 5, 'Moss');
insert into public.pack_members (pack_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a6', 'admin'),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000b6', 'member');

-- The week of Sunday, Sep 6 2026. Noa fed 6 days, Dan 5; photos from both, plus one extra post.
insert into public.feeds (pack_id, user_id, day, photo_path, is_extra, created_at)
select '10000000-0000-0000-0000-000000000006', u, d::date, 'p/' || u || '/' || d::date || e::text || '.jpg', e, d + interval '10 hours'
from unnest(array['00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b6']::uuid[]) u,
  generate_series('2026-09-06'::date, '2026-09-12'::date, interval '1 day') d,
  unnest(array[false, true]) e
where (not e or (u = '00000000-0000-0000-0000-0000000000a6' and d = '2026-09-08'))
  and not (u = '00000000-0000-0000-0000-0000000000b6' and d in ('2026-09-07', '2026-09-09'));
delete from public.notifications;

insert into public.day_results (pack_id, day, result, applied, fed_ids, rested_ids, missed_ids, health_before, health_after, coins)
select '10000000-0000-0000-0000-000000000006', d::date,
  case when d::date = '2026-09-09' then 'fail' else 'success' end::public.day_type, true,
  case
    when d::date = '2026-09-10' then array['00000000-0000-0000-0000-0000000000b6'::uuid]
    when d::date in ('2026-09-07', '2026-09-09') then array['00000000-0000-0000-0000-0000000000a6'::uuid]
    else array['00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b6']::uuid[]
  end,
  case when d::date = '2026-09-07' then array['00000000-0000-0000-0000-0000000000b6'::uuid] else '{}' end,
  case
    when d::date = '2026-09-09' then array['00000000-0000-0000-0000-0000000000b6'::uuid]
    when d::date = '2026-09-10' then array['00000000-0000-0000-0000-0000000000a6'::uuid]
    else '{}'
  end,
  70 + extract(day from d)::int - 6, 71 + extract(day from d)::int - 6,
  case when d::date = '2026-09-09' then 0 else 2 end
from generate_series('2026-09-06'::date, '2026-09-11'::date, interval '1 day') d;
set constraints all immediate;
select is((select count(*) from public.weekly_recaps), 0::bigint, 'no recap before the week''s last day closes');

insert into public.day_results (pack_id, day, result, applied, fed_ids, health_before, health_after, coins)
values ('10000000-0000-0000-0000-000000000006', '2026-09-12', 'success', true,
  array['00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b6']::uuid[], 76, 81, 3);
set constraints all immediate;

select is(
  (select week_start from public.weekly_recaps), '2026-09-06'::date,
  'closing Saturday creates the recap of the week that started on Sunday'
);
select is(
  (select (stats ->> 'days') || '/' || (stats ->> 'successDays') from public.weekly_recaps), '7/6',
  'six good days out of seven'
);
select is((select (stats ->> 'coins')::int from public.weekly_recaps), 13, 'and the coins the week earned');
select is(
  (select (stats ->> 'healthStart') || ' -> ' || (stats ->> 'healthEnd') from public.weekly_recaps), '70 -> 81',
  'health from the start to the end of the week'
);
select is(
  (select stats -> 'topMembers' from public.weekly_recaps), '["00000000-0000-0000-0000-0000000000a6"]'::jsonb,
  'Noa was the most consistent'
);
select is(
  (select stats -> 'critter' ->> 'name' from public.weekly_recaps), 'Moss',
  'the critter as the week ended'
);
select is(
  (select array_length(feed_ids, 1) from public.weekly_recaps), 9,
  'the collage has up to 9 photos'
);
select is(
  (select count(*) from public.notifications where type = 'weekly_recap'), 2::bigint,
  'both members hear the recap is ready'
);

-- A recap lists what no earlier recap of the pack listed. A day closes the next morning, so the
-- achievements of a week's last day carry a time after the week has ended.
insert into public.packs (id, name, category, rest_days_per_week, week_start, timezone, invite_code)
values
  ('10000000-0000-0000-0000-000000000016', 'Walkers', 'reading', 0, 'sunday', 'Asia/Jerusalem', 'WALK2345'),
  ('10000000-0000-0000-0000-000000000026', 'Hikers', 'reading', 0, 'sunday', 'Asia/Jerusalem', 'HKRS2345');
insert into public.critters (pack_id, species, status, stage, health, streak, name)
values
  ('10000000-0000-0000-0000-000000000016', 'hoot', 'active', 'kid', 81, 5, 'Fern'),
  ('10000000-0000-0000-0000-000000000026', 'hoot', 'active', 'kid', 81, 5, 'Sage');

insert into public.achievements (pack_id, key, unlocked_at) values
  ('10000000-0000-0000-0000-000000000016', 'hatched', '2026-09-08 04:05+03'),
  ('10000000-0000-0000-0000-000000000016', 'streak_7', '2026-09-13 04:06+03');
insert into public.day_results (pack_id, day, result, applied, health_before, health_after, coins)
values ('10000000-0000-0000-0000-000000000016', '2026-09-12', 'success', true, 76, 81, 3);
select is(
  (select stats -> 'achievements' from public.weekly_recaps where pack_id = '10000000-0000-0000-0000-000000000016'),
  '["hatched", "streak_7"]'::jsonb,
  'a pack''s first recap lists all it has unlocked, the close of the last day included'
);

insert into public.achievements (pack_id, key, unlocked_at)
values ('10000000-0000-0000-0000-000000000016', 'full_house', '2026-09-15 04:05+03');
insert into public.day_results (pack_id, day, result, applied, health_before, health_after, coins)
values ('10000000-0000-0000-0000-000000000016', '2026-09-19', 'success', true, 76, 81, 3);
select is(
  (select stats -> 'achievements' from public.weekly_recaps
   where pack_id = '10000000-0000-0000-0000-000000000016' and week_start = '2026-09-13'),
  '["full_house"]'::jsonb,
  'the next week lists only its own'
);

-- A recap already stored without an achievement unlocked in the same close: it goes in the next one.
insert into public.weekly_recaps (pack_id, week_start, stats, created_at)
values ('10000000-0000-0000-0000-000000000026', '2026-09-06', '{"achievements": ["hatched"]}', '2026-09-13 04:06+03');
insert into public.achievements (pack_id, key, unlocked_at) values
  ('10000000-0000-0000-0000-000000000026', 'hatched', '2026-09-08 04:05+03'),
  ('10000000-0000-0000-0000-000000000026', 'streak_7', '2026-09-13 04:06+03'),
  ('10000000-0000-0000-0000-000000000026', 'full_house', '2026-09-20 04:06+03');
insert into public.day_results (pack_id, day, result, applied, health_before, health_after, coins)
values ('10000000-0000-0000-0000-000000000026', '2026-09-19', 'success', true, 76, 81, 3);
select is(
  (select stats -> 'achievements' from public.weekly_recaps
   where pack_id = '10000000-0000-0000-0000-000000000026' and week_start = '2026-09-13'),
  '["streak_7", "full_house"]'::jsonb,
  'an achievement a stored recap left out is listed by the next one, not lost'
);

select * from finish();
rollback;
