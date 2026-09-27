-- Profile photos: own folder only, visible to pack mates.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b8', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c8', 'eve@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000008', 'Gym squad', 'gym', 1, 'UTC', 'AVTR2345');
insert into public.pack_members (pack_id, user_id, role) values
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a8', 'admin'),
  ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000b8', 'member');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a8');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a8/1.jpg');
     update public.profiles set avatar_path = '00000000-0000-0000-0000-0000000000a8/1.jpg' where id = '00000000-0000-0000-0000-0000000000a8' $$,
  'Noa uploads a photo into their own folder and uses it'
);
select throws_ok(
  $$ update public.profiles set avatar_path = '00000000-0000-0000-0000-0000000000b8/x.jpg' where id = '00000000-0000-0000-0000-0000000000a8' $$,
  '23514', null, 'the profile can only point at the member''s own folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000b8/2.jpg') $$,
  '42501', null, 'nobody uploads into someone else''s folder'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b8');
select is((select count(*) from storage.objects where bucket_id = 'avatars'), 1::bigint, 'a pack mate can see the photo');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c8');
select is((select count(*) from storage.objects where bucket_id = 'avatars'), 0::bigint, 'a stranger cannot');

select * from finish();
rollback;
