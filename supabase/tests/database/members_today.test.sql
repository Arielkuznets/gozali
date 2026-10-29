-- What members see of today's close: who has started and the rest days each used this week.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000e7', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000f7', 'eve@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000007', 'Walkers', 'walking', 2, 'UTC', 'WALK2345');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000007', 'kit');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000d7', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000e7', 'member', now() - interval '20 days');

-- Noa fed yesterday; Dan never did, and declared a rest yesterday, which hasn't closed.
create temp table today as select public.pack_day('UTC') as day;
grant select on today to authenticated;
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000d7', (select day - 1 from today));
insert into public.day_passes (pack_id, user_id, day, kind)
select '10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000e7', day - 1, 'rest' from today
where extract(dow from day) <> 0;

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select is(
  (select string_agg((m ->> 'hasStarted') || '/' || (m ->> 'restDaysUsedThisWeek'), ', ' order by m ->> 'userId')
   from jsonb_array_elements(public.members_today('10000000-0000-0000-0000-000000000007') -> 'members') m),
  'true/0, false/' || (select case when extract(dow from day) <> 0 then 1 else 0 end from today),
  'Noa has started; Dan hasn''t, and used a rest this week unless the week starts today'
);
select is(
  (public.members_today('10000000-0000-0000-0000-000000000007') ->> 'restDaysPerWeek')::int, 2,
  'with the rest days the week allows'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f7');
select throws_ok(
  $$ select public.members_today('10000000-0000-0000-0000-000000000007') $$,
  '42501', 'not_a_member', 'someone outside the pack sees nothing'
);

select * from finish();
rollback;
