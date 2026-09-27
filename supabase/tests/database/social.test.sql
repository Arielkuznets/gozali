-- Feed events, reactions, nudges, naming, the wardrobe and personal stats.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c4', 'eve@test.local');
update public.profiles set display_name = 'Noa' where id = '00000000-0000-0000-0000-0000000000a4';
update public.profiles set display_name = 'Dan' where id = '00000000-0000-0000-0000-0000000000b4';

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
create temp table pack as
  select public.create_pack('Gym squad', 'gym', 0::smallint, 'blob', 'peach', 'Asia/Jerusalem') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;
select is((select count(*) from public.pack_events), 0::bigint, 'creating a pack is not a join event');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select public.join_pack((select invite_code from code));
select is(
  (select kind::text || ':' || actor_id::text from public.pack_events),
  'joined:00000000-0000-0000-0000-0000000000b4',
  'joining shows in the feed'
);

-- Naming is open only after hatching.
select throws_ok($$ select public.suggest_name((select id from pack), 'Pixel') $$, 'P0001', 'name_not_open', 'an egg has no name to suggest yet');

-- The server hatches the critter and unlocks the first achievement.
reset role;
update public.critters set status = 'active', stage = 'baby', xp = 1, health = 80 where pack_id = (select id from pack);
insert into public.achievements (pack_id, key) values ((select id from pack), 'hatched');
update public.critters set stage = 'kid', xp = 7 where pack_id = (select id from pack);
select is(
  (select array_agg(kind::text order by created_at, kind) from public.pack_events where kind <> 'joined' and pack_id = (select id from pack)),
  array['hatched', 'achievement', 'evolved'],
  'hatching, the achievement and the evolution appear as events'
);
select is(
  (select payload ->> 'to' from public.pack_events where kind = 'evolved' and pack_id = (select id from pack)), 'kid',
  'the evolution names the new stage'
);

-- Joker events follow the pass.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select public.use_day_pass((select id from pack), 'joker');
select is((select count(*) from public.pack_events where kind = 'joker'), 1::bigint, 'taking a joker shows in the feed');
select public.cancel_day_pass((select id from pack));
select is((select count(*) from public.pack_events where kind = 'joker'), 0::bigint, 'taking it back removes the line');

-- Names.
select lives_ok($$ select public.suggest_name((select id from pack), '  Pixel  ') $$, 'Dan suggests a name');
select public.suggest_name((select id from pack), 'Blobby');
select public.suggest_name((select id from pack), 'Mochi');
select throws_ok($$ select public.suggest_name((select id from pack), 'Four') $$, 'P0001', 'too_many_suggestions', 'three suggestions each');
select throws_ok(
  $$ select public.choose_name((select id from pack), (select id from public.name_suggestions where name = 'Pixel')) $$,
  '42501', 'admin_only', 'only the admin picks'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select lives_ok(
  $$ select public.choose_name((select id from pack), (select id from public.name_suggestions where name = 'Pixel')) $$,
  'the admin picks Pixel'
);
select is((select name from public.critters), 'Pixel', 'the critter is named');
select is(
  (select payload ->> 'name' from public.pack_events where kind = 'named'), 'Pixel',
  'the naming shows in the feed'
);
select throws_ok(
  $$ select public.choose_name((select id from pack), (select id from public.name_suggestions where name = 'Mochi')) $$,
  'P0001', 'name_not_open', 'a critter is named once'
);

-- Wardrobe.
select throws_ok($$ select public.dress_critter((select id from pack), 'head', 'beanie') $$, 'P0001', 'item_locked', 'the beanie needs a 7-day streak');
select throws_ok($$ select public.dress_critter((select id from pack), 'head', 'scarf') $$, 'P0001', 'item_locked', 'an item only fits its own slot');
select throws_ok($$ select public.dress_critter((select id from pack), 'feet', 'scarf') $$, '22023', 'bad_slot', 'slots are head, neck and background');
select lives_ok($$ select public.dress_critter((select id from pack), 'neck', 'scarf') $$, 'the scarf (Hello world) can be worn');
select is((select outfit ->> 'neck' from public.critters), 'scarf', 'the critter wears it');
select is(
  (select payload ->> 'item' || ':' || actor_id::text from public.pack_events where kind = 'dressed'),
  'scarf:00000000-0000-0000-0000-0000000000a4',
  'the feed says who dressed the critter'
);
select public.dress_critter((select id from pack), 'neck', null);
select is((select outfit from public.critters), '{}'::jsonb, 'null takes the item off');

-- A feed from Dan to react to and to nudge around.
reset role;
insert into public.feeds (id, pack_id, user_id, day)
values ('20000000-0000-0000-0000-000000000001', (select id from pack), '00000000-0000-0000-0000-0000000000b4', public.pack_day('Asia/Jerusalem'));
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select public.react('20000000-0000-0000-0000-000000000001', 'fire');
select public.react('20000000-0000-0000-0000-000000000001', 'clap');
select is(
  (select emoji::text || ' ' || total || ' ' || mine || ' ' || array_to_string(names, ',') from public.feed_reactions(array['20000000-0000-0000-0000-000000000001'::uuid])),
  'clap 1 true Noa',
  'one reaction per member: changing it replaces the old one, with the name shown'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select public.react('20000000-0000-0000-0000-000000000001', 'suspicious');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select is(
  (select total || ' ' || mine || ' ' || cardinality(names) from public.feed_reactions(array['20000000-0000-0000-0000-000000000001'::uuid]) where emoji = 'suspicious'),
  '1 false 0',
  'the suspicious emoji is a number without names'
);
select public.react('20000000-0000-0000-0000-000000000001', null);
select is(
  (select count(*) from public.feed_reactions(array['20000000-0000-0000-0000-000000000001'::uuid]) where mine), 0::bigint,
  'null takes a reaction back'
);
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b4');
select is(
  (select count(*) from public.feed_reactions(array['20000000-0000-0000-0000-000000000001'::uuid])), 0::bigint,
  'reactions from a blocked member are hidden'
);
delete from public.blocks;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c4');
select throws_ok(
  $$ select public.react('20000000-0000-0000-0000-000000000001', 'fire') $$,
  'P0002', 'feed_not_found', 'a stranger cannot react'
);

-- Nudges.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b4');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select throws_ok(
  $$ select public.nudge((select id from pack), '00000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'cannot_nudge', 'nobody nudges someone who blocked them'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
delete from public.blocks;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select throws_ok(
  $$ select public.nudge((select id from pack), '00000000-0000-0000-0000-0000000000b4') $$,
  '22023', 'cannot_nudge_self', 'nobody nudges themselves'
);
select lives_ok(
  $$ select public.nudge((select id from pack), '00000000-0000-0000-0000-0000000000a4') $$,
  'Dan nudges Noa'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select is(
  (select type::text || ':' || (payload ->> 'from') from public.notifications where user_id = '00000000-0000-0000-0000-0000000000a4' and type = 'nudge'),
  'nudge:00000000-0000-0000-0000-0000000000b4',
  'Noa gets a nudge notification'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b4');
select throws_ok(
  $$ select public.nudge((select id from pack), '00000000-0000-0000-0000-0000000000a4') $$,
  'P0001', 'already_nudged', 'once a day'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select throws_ok(
  $$ select public.nudge((select id from pack), '00000000-0000-0000-0000-0000000000b4') $$,
  'P0001', 'already_fed', 'no nudging someone who fed'
);

-- Personal stats: fed, missed, fed, fed, rested gives a best streak of 3 and a current one of 3.
reset role;
insert into public.day_results (pack_id, day, result, applied, fed_ids, rested_ids, missed_ids, health_before, health_after)
select (select id from pack), d.day, 'success', true, d.fed, d.rested, d.missed, 70, 70
from (values
  (current_date - 6, array['00000000-0000-0000-0000-0000000000a4'::uuid], '{}'::uuid[], '{}'::uuid[]),
  (current_date - 5, '{}'::uuid[], '{}'::uuid[], array['00000000-0000-0000-0000-0000000000a4'::uuid]),
  (current_date - 4, array['00000000-0000-0000-0000-0000000000a4'::uuid], '{}'::uuid[], '{}'::uuid[]),
  (current_date - 3, array['00000000-0000-0000-0000-0000000000a4'::uuid], '{}'::uuid[], '{}'::uuid[]),
  (current_date - 2, '{}'::uuid[], array['00000000-0000-0000-0000-0000000000a4'::uuid], '{}'::uuid[])
) as d(day, fed, rested, missed);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select is(
  (select (s ->> 'currentStreak') || ' ' || (s ->> 'bestStreak') from public.my_stats() s),
  '3 3',
  'a miss restarts the personal streak; rest days keep it going'
);
select is(
  (select jsonb_array_length(public.my_stats() -> 'days')), 5,
  'the personal board lists the days'
);

select * from finish();
rollback;
