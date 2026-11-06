-- A feed sent again after its answer was lost gets back the feed it made, instead of a second post.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'dan@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
create temp table pack as select public.create_pack('Readers', 'reading', 1::smallint, 'ribbit', 'Asia/Jerusalem') as id;
create temp table code as select invite_code from public.packs where id = (select id from pack);
grant select on pack, code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select public.join_pack((select invite_code from code));

-- Noa's photos, named after the feeds' ids on her phone, as the app uploads them.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f1');
create temp table photos as select
  (select id from pack)::text || '/00000000-0000-0000-0000-0000000000f1/counted.jpg' as counted,
  (select id from pack)::text || '/00000000-0000-0000-0000-0000000000f1/extra.jpg' as extra;
grant select on photos to authenticated;
insert into storage.objects (bucket_id, name, owner_id)
select 'feed-photos', name, '00000000-0000-0000-0000-0000000000f1'
from photos cross join lateral (values (photos.counted), (photos.extra)) as files (name);

-- The day's feed is saved, but its answer never reaches the phone.
create temp table first as select public.submit_feed((select id from pack), (select counted from photos)) as id;
grant select on first to authenticated;

select is(
  public.submit_feed((select id from pack), (select counted from photos)),
  (select id from first),
  'sending the same feed again gets back the feed it made'
);
select is(
  public.submit_feed((select id from pack), (select counted from photos), null, null, null, true),
  (select id from first),
  'also when the app sends it again as an extra post'
);
select is(
  (select count(*) from public.feeds where photo_path = (select counted from photos)),
  1::bigint,
  'and the photo is posted once'
);

-- An extra post sent twice.
create temp table extra_post as
  select public.submit_feed((select id from pack), (select extra from photos), null, null, null, true) as id;
grant select on extra_post to authenticated;
select isnt((select id from extra_post), (select id from first), 'an extra post after the counted feed is a new feed');
select is(
  public.submit_feed((select id from pack), (select extra from photos), null, null, null, true),
  (select id from extra_post),
  'sent again, it gets back the extra post it made'
);
select is(
  (select count(*) from public.feeds where pack_id = (select id from pack)),
  2::bigint,
  'so the pack has the counted feed and one extra post'
);

-- Another member can't take over Noa's feed with her photo's name.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f2');
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select counted from photos)) $$,
  'P0001', 'photo_missing', 'someone else''s photo still isn''t theirs to send'
);

select * from finish();
rollback;
