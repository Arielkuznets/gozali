-- Word filtering, reports that hide an item, and the helpers of account deletion.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select ok(public.is_clean('Leg day, done'), 'ordinary captions pass');
select ok(not public.is_clean('what the fuuuck'), 'repeated letters don''t get around the filter');
select ok(not public.is_clean('sh1t happens'), 'nor do digits for letters');
select ok(public.is_clean('Assassin class, then a glass of water'), 'blocked words inside ordinary words are fine');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c7', 'maya@test.local'),
  ('00000000-0000-0000-0000-0000000000d7', 'eli@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.create_pack('Shit squad', 'gym', 1::smallint, 'blob', 'peach', 'UTC') $$,
  '22023', 'text_not_allowed', 'pack names are filtered'
);
select throws_ok(
  $$ update public.profiles set display_name = 'Bitchy' where id = '00000000-0000-0000-0000-0000000000a7' $$,
  '22023', 'text_not_allowed', 'display names are filtered'
);
create temp table pack as select public.create_pack('Gym squad', 'gym', 1::smallint, 'blob', 'peach', 'UTC') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;
reset role;
insert into public.pack_members (pack_id, user_id)
select id, u from pack, unnest(array['00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000d7']::uuid[]) u;
insert into storage.objects (bucket_id, name)
select 'feed-photos', (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a7/' || n || '.jpg' from generate_series(1, 2) n;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a7/1.jpg', 'fucking finally') $$,
  '22023', 'text_not_allowed', 'captions are filtered'
);
select lives_ok(
  $$ select public.submit_feed((select id from pack), (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a7/1.jpg', 'Finally!') $$,
  'a clean caption goes through'
);

-- Three reports hide the item.
create temp table feed as select id from public.feeds;
grant select on feed to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
insert into public.reports (feed_id, reporter_id, reason) values ((select id from feed), '00000000-0000-0000-0000-0000000000b7', 'Not a workout');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000c7');
select is((select count(*) from public.feeds), 1::bigint, 'two reports leave the item up');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000d7');
select is((select count(*) from public.feeds), 0::bigint, 'the third report hides it from the pack');

reset role;
select is(
  (select (d -> 'author' ->> 'id') || ' ' || (d ->> 'reports') || ' ' || (d -> 'feed' ->> 'hidden')
   from public.report_details((select r.id from public.reports r where r.reason = 'Not a workout')) d),
  '00000000-0000-0000-0000-0000000000a7 3 true',
  'the developer''s alert has the author, the report count and the state'
);
select is(
  (select count(*) from public.account_photo_paths('00000000-0000-0000-0000-0000000000a7')), 2::bigint,
  'all of a member''s photo files are found for deletion'
);

-- A pack whose members all left is dropped 30 days later, unless someone joins it again.
update public.pack_members set status = 'left', left_at = now(), role = 'member' where pack_id = (select id from pack);
select ok(
  (select id from pack) not in (select public.empty_packs(now() + interval '29 days')),
  'an empty pack waits 30 days'
);
select ok((select id from pack) in (select public.empty_packs(now() + interval '31 days')), 'then it is due');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select public.join_pack((select invite_code from code));
reset role;
select is(
  (select role::text from public.pack_members where pack_id = (select id from pack) and user_id = '00000000-0000-0000-0000-0000000000d7'),
  'admin', 'whoever joins an empty pack becomes its admin'
);
select ok((select id from pack) not in (select public.empty_packs(now() + interval '31 days')), 'and it is kept');
update public.pack_members set status = 'left', left_at = now(), role = 'member' where pack_id = (select id from pack);
select ok(public.drop_empty_packs(now() + interval '31 days') >= 1, 'an empty pack is removed after 30 days');
select is((select count(*) from public.packs where id = (select id from pack)), 0::bigint, 'and gone');

select * from finish();
rollback;
