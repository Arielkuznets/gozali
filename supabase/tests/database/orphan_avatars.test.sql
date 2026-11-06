-- Avatar files whose account is gone are found for cleanup once they are a day old.
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'noa@test.local');

insert into storage.objects (bucket_id, name, created_at) values
  ('avatars', '00000000-0000-0000-0000-0000000000c2/me.jpg', now() - interval '10 days'),
  ('avatars', '00000000-0000-0000-0000-0000000000d2/gone.jpg', now() - interval '10 days'),
  ('avatars', '00000000-0000-0000-0000-0000000000e2/new.jpg', now() - interval '1 hour'),
  ('feed-photos', '00000000-0000-0000-0000-0000000000d2/fed.jpg', now() - interval '10 days');

select results_eq(
  $$ select * from public.orphan_avatars() where orphan_avatars like '00000000-0000-0000-0000-0000000000%2/%' $$,
  $$ values ('00000000-0000-0000-0000-0000000000d2/gone.jpg'::text) $$,
  'only the old avatar of an account that is gone, and nothing from other buckets'
);

set local role authenticated;
select throws_ok($$ select public.orphan_avatars() $$, '42501', null, 'members can''t list them');

select * from finish();
rollback;
