-- Rest days, jokers, pauses, and the guards of apply_day_result.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'dan@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
create temp table pack as
  select public.create_pack('Runners', 'running', 1::smallint, 'kit', 'Asia/Jerusalem') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;

select is(
  (select public.my_day_status((select id from pack)) ->> 'restDaysLeft'), '1',
  'a new week starts with the pack''s rest days'
);
select is(
  (select public.my_day_status((select id from pack)) ->> 'jokerAvailable'), 'true',
  'and a joker for the month'
);

-- Day passes.
select lives_ok($$ select public.use_day_pass((select id from pack), 'rest') $$, 'Noa declares a rest day');
select is(
  (select kind::text from public.day_passes where user_id = '00000000-0000-0000-0000-0000000000a3'), 'rest',
  'the pass is saved for today'
);
select throws_ok(
  $$ select public.use_day_pass((select id from pack), 'joker') $$,
  'P0001', 'already_passed', 'one pass a day'
);
select lives_ok($$ select public.cancel_day_pass((select id from pack)) $$, 'Noa takes the rest back');
select lives_ok($$ select public.use_day_pass((select id from pack), 'joker') $$, 'and uses the joker instead');
select is(
  (select public.my_day_status((select id from pack)) ->> 'jokerAvailable'), 'false',
  'the month''s joker is used'
);
select public.cancel_day_pass((select id from pack));
select is(
  (select public.my_day_status((select id from pack)) ->> 'jokerAvailable'), 'true',
  'cancelling returns the joker'
);

-- A joker earlier in the month blocks another one.
reset role;
insert into public.day_passes (pack_id, user_id, day, kind)
select id, '00000000-0000-0000-0000-0000000000a3',
  date_trunc('month', public.pack_day('Asia/Jerusalem'))::date + case when extract(day from public.pack_day('Asia/Jerusalem')) = 1 then 1 else 0 end,
  'joker'
from pack;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok(
  $$ select public.use_day_pass((select id from pack), 'joker') $$,
  'P0001', null, 'a second joker in the same month is refused'
);
reset role;
delete from public.day_passes;

-- A declared rest earlier this week (not closed yet) uses the only rest day.
insert into public.day_passes (pack_id, user_id, day, kind)
select id, '00000000-0000-0000-0000-0000000000a3', rules.week_from, 'rest'
from pack, public.pack_rules_on((select id from pack), public.pack_day('Asia/Jerusalem')) rules
where rules.week_from < public.pack_day('Asia/Jerusalem');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select is(
  (select public.my_day_status((select id from pack)) ->> 'restDaysLeft')::int,
  case when extract(dow from public.pack_day('Asia/Jerusalem')) = 0 then 1 else 0 end,
  'rest days already declared this week are used up (unless today starts the week)'
);
reset role;
delete from public.day_passes;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');

-- Pauses.
select throws_ok($$ select public.start_pause((select id from pack), 2) $$, '22023', 'pause_length', 'a pause lasts at least 3 days');
select throws_ok($$ select public.start_pause((select id from pack), 61) $$, '22023', 'pause_length', 'and at most 60');
select lives_ok($$ select public.start_pause((select id from pack), 7) $$, 'Noa pauses for a week');
select is(
  (select starts_on - public.pack_day('Asia/Jerusalem') from public.pauses), 1,
  'the pause starts tomorrow'
);
select is(
  (select ends_on - starts_on from public.pauses), 6,
  'and covers 7 days'
);
select throws_ok($$ select public.start_pause((select id from pack), 5) $$, 'P0001', 'already_paused', 'one pause at a time');
select lives_ok($$ select public.end_pause((select id from pack)) $$, 'a pause that hasn''t started can be cancelled');
select is((select count(*) from public.pauses), 0::bigint, 'and it is gone');

-- A running pause ends only after 3 days, and a new one waits 30 days after the last.
reset role;
insert into public.pauses (pack_id, user_id, starts_on, ends_on)
select id, '00000000-0000-0000-0000-0000000000a3', public.pack_day('Asia/Jerusalem') - 1, public.pack_day('Asia/Jerusalem') + 5 from pack;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.end_pause((select id from pack)) $$, 'P0001', 'pause_too_short', 'a pause runs at least 3 days');
select throws_ok(
  $$ select public.use_day_pass((select id from pack), 'rest') $$,
  'P0001', 'paused', 'no passes while paused'
);
reset role;
update public.pauses set starts_on = public.pack_day('Asia/Jerusalem') - 4;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.end_pause((select id from pack)) $$, 'after 4 days it can end');
select is(
  (select ends_on from public.pauses), public.pack_day('Asia/Jerusalem') - 1,
  'the member counts again from today'
);
select throws_ok($$ select public.start_pause((select id from pack), 5) $$, 'P0001', 'pause_cooldown', 'the next pause waits 30 days');

-- apply_day_result guards (service role only).
reset role;
select throws_ok(
  $$ select public.apply_day_result((select id from pack), public.pack_day('Asia/Jerusalem'), '{}') $$,
  'P0001', 'day_not_open', 'days don''t close before a second member joins'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
select public.join_pack((select invite_code from code));
reset role;
create temp table outcome as select jsonb_build_object(
  'type', 'neutral', 'applied', false, 'outcomes', '[]'::jsonb, 'healthBefore', 70,
  'critter', jsonb_build_object('status', 'egg', 'health', 70, 'xp', 0, 'stage', 'egg', 'streak', 0, 'marks', '[]'::jsonb),
  'newlySleeping', '[]'::jsonb, 'events', '[]'::jsonb,
  'facts', jsonb_build_object('fullHouse', false, 'earlyBird', false, 'nightOwlFeeds', 0)
) as body;
select throws_ok(
  $$ select public.apply_day_result((select id from pack), public.pack_day('Asia/Jerusalem') + 1, (select body from outcome)) $$,
  'P0001', 'previous_day_open', 'days close in order'
);
select is(
  public.apply_day_result((select id from pack), public.pack_day('Asia/Jerusalem'), (select body from outcome)), true,
  'the first day closes'
);
select is(
  public.apply_day_result((select id from pack), public.pack_day('Asia/Jerusalem'), (select body from outcome)), false,
  'closing it again changes nothing'
);

-- A joker covers a member the day counts. Anyone else had no use for it and gets it back.
create temp table closing as select public.pack_day('Asia/Jerusalem') + 1 as day;
insert into public.day_passes (pack_id, user_id, day, kind)
select id, member::uuid, (select day from closing), 'joker'
from pack, unnest(array['00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b3']) member;
select public.apply_day_result(
  (select id from pack), (select day from closing),
  (select body || jsonb_build_object('outcomes', jsonb_build_array(
    jsonb_build_object('userId', '00000000-0000-0000-0000-0000000000a3', 'outcome', 'joker'),
    jsonb_build_object('userId', '00000000-0000-0000-0000-0000000000b3', 'outcome', 'sleeping')
  )) from outcome)
);
select is(
  (select array_agg(user_id) from public.day_passes where kind = 'joker'),
  array['00000000-0000-0000-0000-0000000000a3'::uuid],
  'a joker that covered its member stays spent, and a sleeping member''s goes back'
);
select is(
  (select array_agg(actor_id) from public.pack_events where kind = 'joker'),
  array['00000000-0000-0000-0000-0000000000a3'::uuid],
  'and the feed stops saying that member took one'
);

insert into public.day_passes (pack_id, user_id, day, kind)
select id, '00000000-0000-0000-0000-0000000000b3', (select day + 1 from closing), 'joker' from pack;
select public.apply_day_result(
  (select id from pack), (select day + 1 from closing),
  (select body || jsonb_build_object('outcomes', jsonb_build_array(
    jsonb_build_object('userId', '00000000-0000-0000-0000-0000000000b3', 'outcome', 'not_started')
  )) from outcome)
);
select is(
  (select count(*) from public.day_passes where user_id = '00000000-0000-0000-0000-0000000000b3'), 0::bigint,
  'so does the joker of a member who hasn''t started'
);

-- Days before a pack's first day never close, so nothing taken on them is spent. Tal is alone in a
-- new pack, takes a joker and has an older rest; Gil joins the next day.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c3', 'tal@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'gil@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'eve@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'ori@test.local');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
create temp table lonely as
  select public.create_pack('Solo', 'running', 1::smallint, 'kit', 'Asia/Jerusalem') as id,
    public.pack_day('Asia/Jerusalem') as today;
create temp table lonely_code as select invite_code from public.packs where id = (select id from lonely);
grant select on lonely, lonely_code to authenticated;
select public.use_day_pass((select id from lonely), 'joker');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d3');
select public.join_pack((select invite_code from lonely_code));
reset role;
update public.pack_members set joined_at = now() + interval '1 day'
where pack_id = (select id from lonely) and user_id = '00000000-0000-0000-0000-0000000000d3';
-- The week starts before the rest, so the count doesn't depend on the day this test runs.
update public.packs set week_changed_on = (select today - 1 from lonely) where id = (select id from lonely);
insert into public.day_passes (pack_id, user_id, day, kind)
select id, '00000000-0000-0000-0000-0000000000c3', today - 1, 'rest' from lonely;
select is(
  public.rest_days_used((select id from lonely), '00000000-0000-0000-0000-0000000000c3', (select today + 2 from lonely)), 1,
  'a rest taken alone counts until the first day closes'
);
select public.apply_day_result(
  (select id from lonely), (select today + 1 from lonely), (select body from outcome)
);
select is(
  (select count(*) from public.day_passes where pack_id = (select id from lonely)), 0::bigint,
  'the first close gives back what was taken on the days before it'
);
select is(
  public.rest_days_used((select id from lonely), '00000000-0000-0000-0000-0000000000c3', (select today + 2 from lonely)), 0,
  'so the rest is free again'
);
select is(
  (select count(*) from public.pack_events where pack_id = (select id from lonely) and kind = 'joker'), 0::bigint,
  'and the feed stops saying the joker was taken'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select is(
  (select public.my_day_status((select id from lonely)) ->> 'jokerAvailable'), 'true',
  'and the joker is theirs for the month'
);
reset role;

-- Eve fed once alone, so she counts from the first day on. Her older rest and joker must not cost
-- her that day: it closes before a close could give them back.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e3');
create temp table started as
  select public.create_pack('Early', 'running', 1::smallint, 'kit', 'Asia/Jerusalem') as id,
    public.pack_day('Asia/Jerusalem') as today;
create temp table started_code as select invite_code from public.packs where id = (select id from started);
grant select on started, started_code to authenticated;
reset role;
update public.packs set week_changed_on = (select today - 2 from started) where id = (select id from started);
update public.pack_members set joined_at = now() - interval '3 days' where pack_id = (select id from started);
insert into public.feeds (pack_id, user_id, day, created_at)
select id, '00000000-0000-0000-0000-0000000000e3', today - 3, now() - interval '3 days' from started;
insert into public.day_passes (pack_id, user_id, day, kind)
select id, '00000000-0000-0000-0000-0000000000e3', today - taken.ago, taken.kind::public.day_pass_kind
from started, (values (1, 'rest'), (2, 'joker')) as taken (ago, kind);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f3');
select public.join_pack((select invite_code from started_code));
reset role;
select is(
  public.pack_first_day((select id from started)), (select today from started),
  'days start to close from the day Ori joins'
);
select is(
  (select (m ->> 'hasStarted') || '/' || (m ->> 'restDaysUsedThisWeek')
   from jsonb_array_elements(
     public.day_close_input((select id from started), (select today from started)) -> 'members'
   ) m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000000e3'),
  'true/0',
  'and on that first day Eve has spent no rest'
);
select is(
  (select count(*) from public.day_passes where pack_id = (select id from started)), 0::bigint,
  'what she took alone came back when Ori joined'
);
select is(
  (select count(*) from public.pack_events where pack_id = (select id from started) and kind = 'joker'), 0::bigint,
  'the feed line about the joker with it'
);

-- A pause wakes a sleeper on its first day. Until then they are asleep as before, so a pause
-- cancelled in time changes nothing. Today is the first day of this pack.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a3', 'mia@test.local'),
  ('00000000-0000-0000-0000-0000000001b3', 'lev@test.local'),
  ('00000000-0000-0000-0000-0000000001c3', 'yoni@test.local'),
  ('00000000-0000-0000-0000-0000000001d3', 'shir@test.local'),
  ('00000000-0000-0000-0000-0000000001e3', 'omer@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000103', 'Sleepers', 'running', 0, 'UTC', 'SLPR3456');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000103', 'kit');
insert into public.pack_members (pack_id, user_id, role, status)
select '10000000-0000-0000-0000-000000000103', v.member, v.role, v.status
from (values
  ('00000000-0000-0000-0000-0000000001b3'::uuid, 'admin'::public.member_role, 'active'::public.member_status),
  ('00000000-0000-0000-0000-0000000001a3', 'member', 'sleeping'),
  ('00000000-0000-0000-0000-0000000001c3', 'member', 'sleeping'),
  ('00000000-0000-0000-0000-0000000001d3', 'member', 'sleeping'),
  ('00000000-0000-0000-0000-0000000001e3', 'member', 'sleeping')
) as v (member, role, status);
insert into storage.objects (bucket_id, name)
values ('feed-photos', '10000000-0000-0000-0000-000000000103/00000000-0000-0000-0000-0000000001c3/1.jpg');
create function pg_temp.standing(member uuid) returns text language sql as $$
  select status || coalesce(' ' || (awake_since - public.pack_day('UTC')), '')
  from public.pack_members where pack_id = '10000000-0000-0000-0000-000000000103' and user_id = member;
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
select public.start_pause('10000000-0000-0000-0000-000000000103', 3);
reset role;
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001a3'), 'sleeping', 'a sleeper who turns on a pause sleeps on');
select is(
  (select m ->> 'membership'
   from jsonb_array_elements(
     public.day_close_input('10000000-0000-0000-0000-000000000103', public.pack_day('UTC')) -> 'members'
   ) m
   where m ->> 'userId' = '00000000-0000-0000-0000-0000000001a3'),
  'sleeping',
  'so the day still leaves them out'
);
select ok(
  not public.counted_on(
    '10000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000001a3', public.pack_day('UTC')
  ),
  'and reminders and "last one" pass them by'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
select public.end_pause('10000000-0000-0000-0000-000000000103');
reset role;
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001a3'), 'sleeping', 'cancelled before it starts, it leaves them asleep');

-- A feed in between wakes Yoni as any feed does, and the cancelled pause doesn't undo that.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001c3');
select public.start_pause('10000000-0000-0000-0000-000000000103', 3);
select public.submit_feed(
  '10000000-0000-0000-0000-000000000103',
  '10000000-0000-0000-0000-000000000103/00000000-0000-0000-0000-0000000001c3/1.jpg'
);
select public.end_pause('10000000-0000-0000-0000-000000000103');
reset role;
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001c3'), 'active 0', 'a feed before the cancel wakes them for good');

-- Mia turns it on again and stays with it, and so does Shir, who then leaves the pack.
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001a3');
select public.start_pause('10000000-0000-0000-0000-000000000103', 3);
select pg_temp.act_as('00000000-0000-0000-0000-0000000001d3');
select public.start_pause('10000000-0000-0000-0000-000000000103', 7);
select public.leave_pack('10000000-0000-0000-0000-000000000103');
reset role;
select is(
  public.apply_day_result(
    '10000000-0000-0000-0000-000000000103', public.pack_day('UTC'), (select body from outcome)
  ),
  true,
  'the day before the pause closes'
);
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001a3'), 'active 1', 'and the pause wakes them from its first day');
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001e3'), 'sleeping', 'nobody without a pause wakes');
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001d3'), 'left 0', 'and nobody who left comes back');

-- Omer's pause starts the day after next, so that close wakes him and this one doesn't.
insert into public.pauses (pack_id, user_id, starts_on, ends_on)
values (
  '10000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000001e3',
  public.pack_day('UTC') + 3, public.pack_day('UTC') + 5
);
select public.apply_day_result(
  '10000000-0000-0000-0000-000000000103', public.pack_day('UTC') + 1, (select body from outcome)
);
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001e3'), 'sleeping', 'a pause further off wakes nobody yet');
select public.apply_day_result(
  '10000000-0000-0000-0000-000000000103', public.pack_day('UTC') + 2, (select body from outcome)
);
select is(pg_temp.standing('00000000-0000-0000-0000-0000000001e3'), 'active 3', 'until the close of the day before it');

-- Ella turns on a pause from tomorrow, then misses today, a third miss: today's close puts her to
-- sleep, and her pause wakes her on its first day all the same, with no "Still in?".
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001f3', 'ella@test.local'),
  ('00000000-0000-0000-0000-0000000002a3', 'ido@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000113', 'Nappers', 'running', 0, 'UTC', 'NAPS3456');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000113', 'kit');
insert into public.pack_members (pack_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-0000000002a3', 'admin'),
  ('10000000-0000-0000-0000-000000000113', '00000000-0000-0000-0000-0000000001f3', 'member');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000001f3');
select public.start_pause('10000000-0000-0000-0000-000000000113', 3);
reset role;
select public.apply_day_result('10000000-0000-0000-0000-000000000113', public.pack_day('UTC'), jsonb_build_object(
  'type', 'fail', 'applied', false, 'healthBefore', 70, 'coins', 0,
  'outcomes', jsonb_build_array(
    jsonb_build_object('userId', '00000000-0000-0000-0000-0000000001f3', 'outcome', 'missed'),
    jsonb_build_object('userId', '00000000-0000-0000-0000-0000000002a3', 'outcome', 'fed')
  ),
  'critter', jsonb_build_object('status', 'egg', 'health', 70, 'xp', 0, 'stage', 'egg', 'streak', 0, 'marks', '[]'::jsonb),
  'newlySleeping', jsonb_build_array('00000000-0000-0000-0000-0000000001f3'),
  'events', jsonb_build_array(jsonb_build_object('type', 'member_slept', 'userId', '00000000-0000-0000-0000-0000000001f3')),
  'facts', jsonb_build_object('fullHouse', false, 'earlyBird', false, 'nightOwlFeeds', 0)
));
select is(
  (select status || coalesce(' ' || (awake_since - public.pack_day('UTC')), '')
   from public.pack_members
   where pack_id = '10000000-0000-0000-0000-000000000113' and user_id = '00000000-0000-0000-0000-0000000001f3'),
  'active 1',
  'one who falls asleep at the close of the day before their pause wakes on its first day'
);
select is(
  (select count(*) from public.notifications where type = 'still_in' and user_id = '00000000-0000-0000-0000-0000000001f3'),
  0::bigint,
  'and isn''t asked "Still in?"'
);

select * from finish();
rollback;
