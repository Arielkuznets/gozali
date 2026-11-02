-- Two tries of the same photo that overlap make one feed: a send given up on can still be running
-- when the queue tries again. Two more sessions (dblink) play the tries, so their rows are committed
-- and are cleared before and after.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(6);

-- Through the server's network address: dblink needs a password, and local connections don't ask for one.
create temp table server as
  select format(
    'host=%s port=%s dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), inet_server_port(), current_database()
  ) as dsn;
select extensions.dblink_connect('setup', dsn) from server;
select extensions.dblink_connect('one', dsn) from server;
select extensions.dblink_connect('two', dsn) from server;
create temp table second_try as select pid from extensions.dblink('two', 'select pg_backend_pid()') as t (pid integer);
select extensions.dblink_exec('setup', $$set storage.allow_delete_query = 'true'$$);

create function pg_temp.clear() returns void language sql as $$
  select extensions.dblink_exec('setup', $q$
    delete from storage.objects where bucket_id = 'feed-photos' and name like '10000000-0000-0000-0000-0000000000fb/%';
    delete from public.packs where id = '10000000-0000-0000-0000-0000000000fb';
    delete from auth.users where id = '00000000-0000-0000-0000-0000000000fb';
  $q$);
$$;
select pg_temp.clear();
select extensions.dblink_exec('setup', $$
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fb', 'race-test@test.local');
  insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
  values ('10000000-0000-0000-0000-0000000000fb', 'Racers', 'gym', 0, 'UTC', 'RACE5678');
  insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-0000000000fb', 'kit');
  insert into public.pack_members (pack_id, user_id, role)
  values ('10000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000fb', 'admin');
  insert into storage.objects (bucket_id, name, owner_id)
  select 'feed-photos', '10000000-0000-0000-0000-0000000000fb/00000000-0000-0000-0000-0000000000fb/' || photo, '00000000-0000-0000-0000-0000000000fb'
  from unnest(array['counted.jpg', 'extra.jpg', 'lost.jpg']) photo;
$$);
select extensions.dblink_exec(name, $$set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000fb", "role": "authenticated"}'$$)
from unnest(array['one', 'two']) name;
select extensions.dblink_exec(name, 'set role authenticated') from unnest(array['one', 'two']) name;
select extensions.dblink_exec(name, $$set lock_timeout = '10s'$$) from unnest(array['one', 'two']) name;

create function pg_temp.path(photo text) returns text language sql as $$
  select '10000000-0000-0000-0000-0000000000fb/00000000-0000-0000-0000-0000000000fb/' || photo;
$$;
create function pg_temp.feed_call(photo text, extra boolean) returns text language sql as $$
  select format(
    'select public.submit_feed(%L, %L, null, null, null, %L)', '10000000-0000-0000-0000-0000000000fb', pg_temp.path(photo), extra
  );
$$;

-- Waits until the second try is done or blocked on a lock (up to five seconds).
create function pg_temp.second_try_settles() returns void language plpgsql as $$
begin
  for n in 1..100 loop
    exit when extensions.dblink_is_busy('two') = 0
      or exists (select 1 from pg_catalog.pg_locks l join second_try s on s.pid = l.pid where not l.granted);
    perform pg_sleep(0.05);
  end loop;
end;
$$;

-- The first try is in the middle of its transaction when the second starts. Says what the second
-- answered: the first try's feed, another feed, or its error.
create function pg_temp.overlapping_tries(photo text, extra boolean) returns text language plpgsql as $$
declare
  first_feed uuid;
  second_feed uuid;
  answer text;
begin
  perform extensions.dblink_exec('one', 'begin');
  select id into first_feed from extensions.dblink('one', pg_temp.feed_call(photo, extra)) as t (id uuid);
  perform extensions.dblink_send_query('two', pg_temp.feed_call(photo, extra));
  perform pg_temp.second_try_settles();
  perform extensions.dblink_exec('one', 'commit');
  begin
    select id into second_feed from extensions.dblink_get_result('two') as t (id uuid);
    answer := case when second_feed = first_feed then 'the same feed' else 'another feed' end;
  exception when others then
    answer := sqlerrm;
  end;
  perform * from extensions.dblink_get_result('two', false) as t (id uuid);
  return answer;
end;
$$;

-- Today's counted feed is sent twice at once. Only the first makes it, and the second is told so
-- in the same words as a retry that comes later.
select is(pg_temp.overlapping_tries('counted.jpg', false), 'the same feed', 'the second try of a feed gets back the first one''s feed');
select is(
  (select count(*) from extensions.dblink('setup', format(
    'select 1 from public.feeds where photo_path = %L', pg_temp.path('counted.jpg')
  )) as t (x integer)),
  1::bigint,
  'and it is posted once'
);

-- An extra post has no unique index to stop the second try.
select is(pg_temp.overlapping_tries('extra.jpg', true), 'the same feed', 'so does the second try of an extra post');
select is(
  (select count(*) from extensions.dblink('setup', format(
    'select 1 from public.feeds where photo_path = %L', pg_temp.path('extra.jpg')
  )) as t (x integer)),
  1::bigint,
  'and it is posted once'
);

-- A first try that fails leaves the photo for the second.
select extensions.dblink_exec('one', 'begin');
select id is not null from extensions.dblink('one', pg_temp.feed_call('lost.jpg', true)) as t (id uuid);
select extensions.dblink_send_query('two', pg_temp.feed_call('lost.jpg', true));
select pg_temp.second_try_settles();
select extensions.dblink_exec('one', 'rollback');
select is(
  (select id is not null from extensions.dblink_get_result('two') as t (id uuid)), true,
  'the second try goes on when the first one failed'
);
select count(*) from extensions.dblink_get_result('two', false) as t (id uuid);
select is(
  (select count(*) from extensions.dblink('setup', format(
    'select 1 from public.feeds where photo_path = %L', pg_temp.path('lost.jpg')
  )) as t (x integer)),
  1::bigint,
  'and posts it'
);

select pg_temp.clear();
select extensions.dblink_disconnect(name) from unnest(array['setup', 'one', 'two']) name;
select * from finish();
rollback;
