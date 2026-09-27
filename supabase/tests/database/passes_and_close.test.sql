-- Rest days, jokers, pauses, and the guards of apply_day_result.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'dan@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
create temp table pack as
  select public.create_pack('Runners', 'running', 1::smallint, 'spark', 'sky', 'Asia/Jerusalem') as id;
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

select * from finish();
rollback;
