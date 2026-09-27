-- Photo files without a feed are found for cleanup once they are a week old.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'noa@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-0000000000c1', 'Gym squad', 'gym', 1, 'UTC', 'PACKCCC2');
insert into public.pack_members (pack_id, user_id, role)
values ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'admin');
insert into public.feeds (pack_id, user_id, day, photo_path) values
  ('10000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', '2026-09-01', 'p/noa/fed.jpg');

insert into storage.objects (bucket_id, name, created_at) values
  ('feed-photos', 'p/noa/fed.jpg', now() - interval '10 days'),
  ('feed-photos', 'p/noa/lost.jpg', now() - interval '10 days'),
  ('feed-photos', 'p/noa/just-uploaded.jpg', now() - interval '1 hour'),
  ('avatars', 'noa/me.jpg', now() - interval '10 days');

select results_eq(
  $$ select * from public.orphan_photos()
     where orphan_photos in ('p/noa/fed.jpg', 'p/noa/lost.jpg', 'p/noa/just-uploaded.jpg', 'noa/me.jpg') $$,
  $$ values ('p/noa/lost.jpg'::text) $$,
  'only the old file no feed points at, and nothing from other buckets'
);

set local role authenticated;
select throws_ok($$ select public.orphan_photos() $$, '42501', null, 'members can''t list them');

select * from finish();
rollback;
