-- Packs made and left in a loop: an account starts at most ten packs a day, and a run of the close
-- drops empty packs a thousand at a time, the photos it removes first being theirs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a3', 'mal@test.local'),
  ('00000000-0000-0000-0000-0000000005b3', 'noa@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;

-- Ten packs started and left, so none is still open.
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a3');
do $$
begin
  for n in 1..10 loop
    perform public.leave_pack(public.create_pack('Pack ' || n, 'gym', 1::smallint, 'kit', 'UTC'));
  end loop;
end;
$$;
select throws_ok(
  $$ select public.create_pack('Pack 11', 'gym', 1::smallint, 'kit', 'UTC') $$,
  'P0001', 'pack_limit_reached', 'the eleventh pack in a day is refused'
);
update public.pack_members set joined_at = now() - interval '25 hours'
where user_id = '00000000-0000-0000-0000-0000000005a3';
select lives_ok(
  $$ select public.create_pack('Pack 11', 'gym', 1::smallint, 'kit', 'UTC') $$,
  'a day later the account starts packs again'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000005b3');
select lives_ok(
  $$ select public.create_pack('Readers', 'reading', 1::smallint, 'kit', 'UTC') $$,
  'and another account was never held back'
);

-- 3,000 packs Noa left 31 days ago, every tenth with a photo.
create temp table aged as
  select gen_random_uuid() as id, case when n % 10 = 0 then 'aged/' || n || '.jpg' end as photo
  from generate_series(1, 3000) n;
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code, created_at)
select id, 'Empty', 'gym', 1, 'UTC', public.new_invite_code(), now() - interval '40 days' from aged;
insert into public.pack_members (pack_id, user_id, role, status, joined_at, left_at)
select id, '00000000-0000-0000-0000-0000000005b3', 'admin', 'left', now() - interval '40 days', now() - interval '31 days'
from aged;
insert into public.feeds (pack_id, user_id, photo_path, day)
select id, '00000000-0000-0000-0000-0000000005b3', photo, current_date - 35 from aged where photo is not null;

create temp table listed as select public.empty_pack_photos(now()) as photo_path;
select is(public.drop_empty_packs(now()), 1000, 'a run drops a thousand empty packs');
select is(
  (select count(*) from aged a
   where a.photo is not null
     and not exists (select 1 from public.packs p where p.id = a.id)
     and a.photo not in (select photo_path from listed)),
  0::bigint,
  'each with its photos listed first'
);
select is(
  (select count(*) from aged a join listed l on l.photo_path = a.photo where exists (select 1 from public.packs p where p.id = a.id)),
  0::bigint,
  'and no photo listed is of a pack it keeps'
);
select is(public.drop_empty_packs(now()), 1000, 'the next run drops the next thousand');

select * from finish();
rollback;
