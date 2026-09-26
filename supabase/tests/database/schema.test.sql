-- Constraints and row level security of the core schema. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- Three users; the trigger creates their profiles. A and B share a pack, C is a stranger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', '{"full_name": "Noa"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', '{}');

select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Noa',
  'a new user gets a profile with the name from the sign-in provider'
);
select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b'),
  null,
  'without a name from the provider the name stays empty'
);

insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000001', 'Gym squad', 'gym', 3, 'Asia/Jerusalem', 'ABCD2345');
insert into public.critters (pack_id, species, color)
values ('10000000-0000-0000-0000-000000000001', 'blob', 'peach');
insert into public.pack_members (pack_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'admin'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'member');
insert into public.feeds (id, pack_id, user_id, day)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000000a', '2026-09-26');
insert into public.reactions (feed_id, user_id, emoji)
values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'suspicious');
insert into public.day_passes (pack_id, user_id, day, kind)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-09-03', 'joker');
insert into public.pauses (pack_id, user_id, starts_on, ends_on)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-11-01', '2026-11-10');

-- Constraints, checked as the table owner.
select throws_ok(
  $$ insert into public.pack_members (pack_id, user_id, role)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'admin') $$,
  '23505', null, 'a pack has only one admin'
);
select throws_ok(
  $$ insert into public.feeds (pack_id, user_id, day)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-09-26') $$,
  '23505', null, 'one counted feed per member per day'
);
select lives_ok(
  $$ insert into public.feeds (pack_id, user_id, day, is_extra)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '2026-09-26', true) $$,
  'extra posts on the same day are allowed'
);
select throws_ok(
  $$ insert into public.day_passes (pack_id, user_id, day, kind)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-09-20', 'joker') $$,
  '23505', null, 'one joker per member per month'
);
select lives_ok(
  $$ insert into public.day_passes (pack_id, user_id, day, kind)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-10-01', 'joker') $$,
  'a new month brings a new joker'
);
select throws_ok(
  $$ insert into public.pauses (pack_id, user_id, starts_on, ends_on)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', '2026-11-10', '2026-11-20') $$,
  '23P01', null, 'the pauses of one member never overlap'
);
select throws_ok(
  $$ insert into public.packs (name, category, rest_days_per_week, timezone, invite_code)
     values ('Readers', 'reading', 0, 'UTC', 'ABCD0000') $$,
  '23514', null, 'invite codes cannot contain look-alike characters'
);
select throws_ok(
  $$ insert into public.feeds (pack_id, user_id, day)
     values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', '2026-09-26') $$,
  '23503', null, 'only members can feed'
);

-- Row level security as member A.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);

select is((select count(*) from public.packs), 1::bigint, 'a member sees their pack');
select is((select count(*) from public.pack_members), 2::bigint, 'a member sees the other members');
select is((select count(*) from public.reactions), 0::bigint, 'nobody sees who reacted with the suspicious emoji');
select results_eq(
  $$ select emoji::text, total from public.feed_reaction_counts('20000000-0000-0000-0000-000000000001') $$,
  $$ values ('suspicious', 1::bigint) $$,
  'but members see how many did'
);
select throws_ok(
  $$ insert into public.packs (name, category, rest_days_per_week, timezone, invite_code)
     values ('Mine', 'gym', 3, 'UTC', 'ZZZZ2222') $$,
  '42501', null, 'packs are created by server functions, not directly'
);

update public.profiles set display_name = 'Noa K' where id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Noa K',
  'users can rename themselves'
);
update public.profiles set display_name = 'Taken over' where id = '00000000-0000-0000-0000-00000000000b';
select is(
  (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b'),
  null,
  'but not anyone else'
);

-- As stranger C.
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);

select is((select count(*) from public.packs), 0::bigint, 'a stranger sees no packs');
select is((select count(*) from public.profiles), 1::bigint, 'a stranger sees only their own profile');
select is((select count(*) from public.feeds), 0::bigint, 'a stranger sees no feeds');

-- Signed out.
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.packs $$, '42501', null, 'signed-out requests are refused');

select * from finish();
rollback;
