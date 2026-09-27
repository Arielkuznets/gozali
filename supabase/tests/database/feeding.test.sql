-- Feeding: the photo bucket's policies, submit_feed and the day a feed counts for.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'eve@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

-- The day a feed counts for, in a fixed time zone (days end at 03:00, grace until 04:00).
select is(
  public.feed_day('Asia/Jerusalem', '2026-09-27 03:40+03', '2026-09-27 02:50+03'),
  '2026-09-26'::date,
  'a feed captured before 03:00 and received in the grace window counts for the day before'
);
select is(
  public.feed_day('Asia/Jerusalem', '2026-09-27 04:10+03', '2026-09-27 02:50+03'),
  '2026-09-27'::date,
  'after the grace window it counts for the day it arrived'
);
select is(
  public.feed_day('Asia/Jerusalem', '2026-09-27 01:30+03', null),
  '2026-09-26'::date,
  'a feed between midnight and 03:00 counts for the day before'
);
select is(
  public.feed_day('Asia/Jerusalem', '2026-09-27 03:40+03', '2026-09-27 05:00+03'),
  '2026-09-27'::date,
  'a capture time in the future is ignored'
);

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
create temp table pack as
  select public.create_pack('Readers', 'reading', 1::smallint, 'ribbit', 'Asia/Jerusalem') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.join_pack((select invite_code from code));

-- Uploads, as the storage API would do them for each user.
create function pg_temp.upload(member uuid, file text) returns text language plpgsql as $$
declare
  object_name text := (select id from pack)::text || '/' || member::text || '/' || file;
begin
  perform pg_temp.act_as(member);
  insert into storage.objects (bucket_id, name, owner_id) values ('feed-photos', object_name, member::text);
  return object_name;
end;
$$;
select lives_ok(
  $$ select pg_temp.upload('00000000-0000-0000-0000-0000000000a2', 'one.jpg') $$,
  'a member uploads into their own folder'
);
select pg_temp.upload('00000000-0000-0000-0000-0000000000a2', 'two.jpg');
select pg_temp.upload('00000000-0000-0000-0000-0000000000b2', 'one.jpg');
select throws_ok(
  $$ select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
     insert into storage.objects (bucket_id, name) values
       ('feed-photos', (select id from pack)::text || '/00000000-0000-0000-0000-0000000000b2/fake.jpg') $$,
  '42501', null, 'nobody uploads into another member''s folder'
);
select throws_ok(
  $$ select pg_temp.upload('00000000-0000-0000-0000-0000000000c2', 'one.jpg') $$,
  '42501', null, 'a stranger cannot upload into the pack'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select is(
  (select count(*) from storage.objects where bucket_id = 'feed-photos'), 0::bigint,
  'a stranger sees none of the pack''s photos'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select is(
  (select count(*) from storage.objects where bucket_id = 'feed-photos'), 3::bigint,
  'members see every photo of their pack'
);

-- submit_feed, as Noa.
create temp table photos as select
  (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a2/one.jpg' as noa_one,
  (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a2/two.jpg' as noa_two,
  (select id from pack)::text || '/00000000-0000-0000-0000-0000000000b2/one.jpg' as dan_one;
grant select on photos to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a2/never.jpg') $$,
  'P0001', 'photo_missing', 'the photo must be uploaded first'
);
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select dan_one from photos)) $$,
  'P0001', 'photo_missing', 'nobody feeds with another member''s photo'
);
select lives_ok(
  $$ select public.submit_feed((select id from pack), (select noa_one from photos), '  Chapter 3 done  ') $$,
  'Noa feeds'
);
select is(
  (select day from public.feeds where not is_extra),
  public.pack_day('Asia/Jerusalem'),
  'the feed counts for today in the pack''s time zone'
);
select is((select caption from public.feeds), 'Chapter 3 done', 'the caption is trimmed');
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select noa_two from photos)) $$,
  'P0001', 'already_fed', 'a second counted feed on the same day is refused'
);
select lives_ok(
  $$ select public.submit_feed((select id from pack), (select noa_two from photos), extra => true) $$,
  'an extra post is fine'
);
select is(
  (select count(*) from public.feeds where is_extra), 1::bigint,
  'and it does not count'
);

-- Dan is asleep and took a joker today; feeding wakes Dan up and returns the joker.
reset role;
update public.pack_members set status = 'sleeping'
where user_id = '00000000-0000-0000-0000-0000000000b2';
insert into public.day_passes (pack_id, user_id, day, kind)
values ((select id from pack), '00000000-0000-0000-0000-0000000000b2', public.pack_day('Asia/Jerusalem'), 'joker');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select public.submit_feed((select id from pack), (select dan_one from photos), extra => true);
select is(
  (select is_extra from public.feeds where user_id = '00000000-0000-0000-0000-0000000000b2'), false,
  'an extra post before the counted feed becomes the counted feed'
);
select is(
  (select status::text || ' ' || (awake_since = public.pack_day('Asia/Jerusalem'))::text
   from public.pack_members where user_id = '00000000-0000-0000-0000-0000000000b2'),
  'active true',
  'feeding wakes a sleeping member and restarts their miss count'
);
select is(
  (select count(*) from public.day_passes), 0::bigint,
  'feeding cancels the joker taken for the same day'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select noa_one from photos)) $$,
  '42501', 'not_a_member', 'a stranger cannot feed the pack'
);

select * from finish();
rollback;
