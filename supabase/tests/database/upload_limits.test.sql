-- Uploads: one account keeps at most 60 feed photos and 20 profile photos uploaded in the last day,
-- and at most 300 MB of feed photos and 5 MB of profile photos however old.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000005b1', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000005c1', 'eve@test.local');
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-0000000005a1', 'Readers', 'reading', 1, 'UTC', 'UPLD2345');
insert into public.pack_members (pack_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a1', 'admin'),
  ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005b1', 'member'),
  ('10000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005c1', 'member');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
-- Uploads files one at a time, as the storage service does, under the caller's name.
create function pg_temp.upload(bucket text, folder text, files integer) returns void language plpgsql as $$
begin
  for n in 1..files loop
    insert into storage.objects (bucket_id, name, owner_id)
    values (bucket, folder || '/' || gen_random_uuid() || '.jpg', (select auth.uid())::text);
  end loop;
end;
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a1');
select lives_ok(
  $$ select pg_temp.upload('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005a1', 60) $$,
  'sixty feed photos go up in a day'
);
select throws_ok(
  $$ select pg_temp.upload('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005a1', 1) $$,
  '42501', null, 'the next one that day is refused'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000005b1');
select lives_ok(
  $$ select pg_temp.upload('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005b1', 1) $$,
  'a pack mate''s photo goes up: each account counts its own'
);

reset role;
update storage.objects set created_at = now() - interval '25 hours'
where id = (select id from storage.objects where owner_id = '00000000-0000-0000-0000-0000000005a1' limit 1);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a1');
select lives_ok(
  $$ select pg_temp.upload('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005a1', 1) $$,
  'a photo uploaded more than a day ago no longer counts'
);

select lives_ok(
  $$ select pg_temp.upload('avatars', '00000000-0000-0000-0000-0000000005a1', 20) $$,
  'twenty profile photos go up in a day, whatever the feed photos'
);
select throws_ok(
  $$ select pg_temp.upload('avatars', '00000000-0000-0000-0000-0000000005a1', 1) $$,
  '42501', null, 'the next one that day is refused'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000005b1');
select lives_ok(
  $$ select pg_temp.upload('avatars', '00000000-0000-0000-0000-0000000005b1', 1) $$,
  'and someone else''s still goes up'
);

-- Storage writes each file's size into its metadata once the file is in.
reset role;
insert into storage.objects (bucket_id, name, owner_id, created_at, metadata) values
  ('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005c1/kept.jpg',
   '00000000-0000-0000-0000-0000000005c1', now() - interval '2 days', '{"size": 299999999}'),
  ('avatars', '00000000-0000-0000-0000-0000000005c1/kept.jpg',
   '00000000-0000-0000-0000-0000000005c1', now() - interval '2 days', '{"size": 4999999}');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000005c1');
select lives_ok(
  $$ select pg_temp.upload('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005c1', 1) $$,
  'a feed photo goes up while the account holds less than 300 MB of them'
);
select lives_ok(
  $$ select pg_temp.upload('avatars', '00000000-0000-0000-0000-0000000005c1', 1) $$,
  'a profile photo goes up while the account holds less than 5 MB of them'
);

reset role;
update storage.objects set metadata = jsonb_build_object('size', (metadata ->> 'size')::bigint + 1)
where owner_id = '00000000-0000-0000-0000-0000000005c1' and name like '%/kept.jpg';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000005c1');
select throws_ok(
  $$ select pg_temp.upload('feed-photos', '10000000-0000-0000-0000-0000000005a1/00000000-0000-0000-0000-0000000005c1', 1) $$,
  '42501', null, 'with 300 MB of feed photos held, from two days ago, the next one is refused'
);
select throws_ok(
  $$ select pg_temp.upload('avatars', '00000000-0000-0000-0000-0000000005c1', 1) $$,
  '42501', null, 'with 5 MB of profile photos held, the next one is refused'
);

select * from finish();
rollback;
