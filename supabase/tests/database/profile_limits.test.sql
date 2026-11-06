-- What a member stores on their profile is read by everyone in their packs, so it has a size.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a6', 'noa@test.local');
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a6', 'role', 'authenticated')::text,
  true
);

-- What the app writes.
select lives_ok(
  $$ update public.profiles set avatar_path = '00000000-0000-0000-0000-0000000000a6/1793664000000.jpg'
     where id = '00000000-0000-0000-0000-0000000000a6' $$,
  'a photo''s path, as the app names it'
);
select lives_ok(
  $$ update public.profiles set locale = 'he' where id = '00000000-0000-0000-0000-0000000000a6' $$,
  'a language'
);
select lives_ok(
  $$ update public.profiles
     set notification_prefs = (select jsonb_object_agg(kind, false) from unnest(enum_range(null::public.notification_type)) kind)
     where id = '00000000-0000-0000-0000-0000000000a6' $$,
  'a choice for every kind of notification'
);

-- What only a crafted request can write.
select lives_ok(
  $$ update public.profiles set avatar_path = '00000000-0000-0000-0000-0000000000a6/' || repeat('a', 163)
     where id = '00000000-0000-0000-0000-0000000000a6' $$,
  'a path can be 200 characters'
);
select throws_ok(
  $$ update public.profiles set avatar_path = '00000000-0000-0000-0000-0000000000a6/' || repeat('a', 164)
     where id = '00000000-0000-0000-0000-0000000000a6' $$,
  '23514', null, 'and no more'
);
select lives_ok(
  $$ update public.profiles set locale = repeat('a', 35) where id = '00000000-0000-0000-0000-0000000000a6' $$,
  'a language tag can be 35 characters'
);
select throws_ok(
  $$ update public.profiles set locale = repeat('a', 36) where id = '00000000-0000-0000-0000-0000000000a6' $$,
  '23514', null, 'and no more'
);
select throws_ok(
  $$ update public.profiles set notification_prefs = jsonb_build_object('nudge', repeat('a', 5000))
     where id = '00000000-0000-0000-0000-0000000000a6' $$,
  '23514', null, 'notification choices can''t carry 5 KB'
);
select throws_ok(
  $$ update public.profiles set notification_prefs = jsonb_build_object('nudge', repeat('a', 20000000))
     where id = '00000000-0000-0000-0000-0000000000a6' $$,
  '23514', null, 'nor 20 MB that would pack down small'
);
reset role;
select is(
  (select pg_column_size(notification_prefs) < 4096 from public.profiles where id = '00000000-0000-0000-0000-0000000000a6'),
  true,
  'and what is stored is what the app wrote'
);

select * from finish();
rollback;
