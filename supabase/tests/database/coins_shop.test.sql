-- Coins from the day close and the outfit shop (decision D21).
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000bb', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000cc', 'eve@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000aa');
create temp table pack as select public.create_pack('Gym squad', 'gym', 0::smallint, 'kit', 'UTC') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000bb');
select public.join_pack((select invite_code from code));
reset role;

select is((select coins from public.critters where pack_id = (select id from pack)), 0, 'a new pack has no coins');

-- A closed day adds the coins the engine counted, and records them with the day.
insert into public.feeds (pack_id, user_id, day)
select id, '00000000-0000-0000-0000-0000000000aa', public.pack_first_day(id) from pack;
select public.apply_day_result(
  (select id from pack),
  (select public.pack_first_day(id) from pack),
  jsonb_build_object(
    'type', 'success', 'applied', true, 'healthBefore', 70, 'coins', 3,
    'critter', jsonb_build_object('status', 'active', 'health', 80, 'xp', 1, 'stage', 'baby', 'streak', 1, 'marks', '[]'::jsonb),
    'outcomes', '[]'::jsonb, 'newlySleeping', '[]'::jsonb, 'events', '[]'::jsonb,
    'facts', jsonb_build_object('earlyBird', false, 'fullHouse', false, 'nightOwlFeeds', 0)
  )
);
select is((select coins from public.critters where pack_id = (select id from pack)), 3, 'the day close adds the coins');
select is((select coins from public.day_results where pack_id = (select id from pack)), 3::smallint, 'and the day remembers them');

-- Shopping.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000bb');
select throws_ok($$ select public.buy_item((select id from pack), 'cap') $$, 'P0001', 'not_enough_coins', '3 coins are not enough for a 12-coin cap');
reset role;
update public.critters set coins = 30 where pack_id = (select id from pack);
set local role authenticated;
select is(public.buy_item((select id from pack), 'cap'), 18, 'any member buys with the pack''s coins; 18 left');
select is(
  (select item || ' by ' || bought_by from public.pack_items where pack_id = (select id from pack)),
  'cap by 00000000-0000-0000-0000-0000000000bb',
  'the cap belongs to the pack now'
);
select is(
  (select kind::text || ' ' || (payload ->> 'item') || ' ' || (payload ->> 'price') from public.pack_events where kind = 'bought'),
  'bought cap 12',
  'the purchase shows in the feed'
);
select throws_ok($$ select public.buy_item((select id from pack), 'cap') $$, 'P0001', 'already_owned', 'the same item is bought once');
select throws_ok($$ select public.buy_item((select id from pack), 'halo') $$, 'P0001', 'not_for_sale', 'achievement rewards are not for sale');
select throws_ok($$ select public.buy_item((select id from pack), 'rocket') $$, 'P0001', 'not_for_sale', 'unknown items are not for sale');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000cc');
select throws_ok($$ select public.buy_item((select id from pack), 'bow') $$, '42501', null, 'outsiders can''t shop for the pack');
select is((select count(*) from public.pack_items), 0::bigint, 'and don''t see what it bought');

-- Wearing what the pack owns.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000aa');
select lives_ok($$ select public.dress_critter((select id from pack), 'head', 'cap') $$, 'a bought item can be worn');
select throws_ok($$ select public.dress_critter((select id from pack), 'neck', 'cap') $$, 'P0001', 'item_locked', 'only in its own slot');
select throws_ok($$ select public.dress_critter((select id from pack), 'neck', 'bell') $$, 'P0001', 'item_locked', 'an item not bought can''t be worn');
reset role;
insert into public.achievements (pack_id, key) values ((select id from pack), 'hatched');
set local role authenticated;
select lives_ok($$ select public.dress_critter((select id from pack), 'neck', 'scarf') $$, 'an achievement''s item stays free');
select throws_ok($$ select public.buy_item((select id from pack), 'scarf') $$, 'P0001', 'already_owned', 'and needn''t be bought');

select * from finish();
rollback;
