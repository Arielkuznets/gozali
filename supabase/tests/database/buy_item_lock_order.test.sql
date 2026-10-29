-- Buying and dressing wait for their pack before they hold the critter, as the day close takes them,
-- so none of them can deadlock with it. Two more sessions (dblink) play the day close and a member;
-- their rows are committed, so they are cleared before and after.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(4);

-- Through the server's network address: dblink needs a password, and local connections don't ask for one.
create temp table server as
  select format('host=%s port=%s dbname=postgres user=postgres password=postgres', host(inet_server_addr()), inet_server_port()) as dsn;
select extensions.dblink_connect('close', dsn) from server;
select extensions.dblink_connect('member', dsn) from server;

create function pg_temp.clear() returns void language sql as $$
  select extensions.dblink_exec('close', $q$
    delete from public.packs where id = '10000000-0000-0000-0000-0000000000fa';
    delete from auth.users where id = '00000000-0000-0000-0000-0000000000fa';
  $q$);
$$;
select pg_temp.clear();
select extensions.dblink_exec('close', $$
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fa', 'lock-test@test.local');
  insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
  values ('10000000-0000-0000-0000-0000000000fa', 'Lockers', 'gym', 0, 'UTC', 'WALK5678');
  insert into public.critters (pack_id, species, status, coins) values ('10000000-0000-0000-0000-0000000000fa', 'kit', 'active', 100);
  insert into public.pack_members (pack_id, user_id, role) values ('10000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000fa', 'admin');
$$);
select extensions.dblink_exec('member', $$set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000fa", "role": "authenticated"}'$$);
select extensions.dblink_exec('member', 'set role authenticated');
select extensions.dblink_exec('member', $$set lock_timeout = '10s'$$);

-- Waits until the member's call is blocked on a lock (up to five seconds).
create function pg_temp.member_waits() returns void language plpgsql as $$
begin
  for n in 1..100 loop
    exit when exists (select 1 from pg_catalog.pg_locks where not granted);
    perform pg_sleep(0.05);
  end loop;
end;
$$;

-- The day close holds the pack while the member does something to its critter; the close then goes
-- on to the critter, which is free only if the member is still waiting for the pack.
create function pg_temp.race(call text) returns bigint language plpgsql as $$
declare
  free bigint;
begin
  perform extensions.dblink_exec('close', 'begin');
  perform * from extensions.dblink('close', $q$select 1 from public.packs where id = '10000000-0000-0000-0000-0000000000fa' for update$q$) as t (x integer);
  perform extensions.dblink_send_query('member', call);
  perform pg_temp.member_waits();
  select count(*) into free from extensions.dblink(
    'close', $q$select 1 from public.critters where pack_id = '10000000-0000-0000-0000-0000000000fa' for update nowait$q$, false
  ) as t (x integer);
  perform extensions.dblink_exec('close', 'rollback');
  return free;
end;
$$;

select is(pg_temp.race($$select public.buy_item('10000000-0000-0000-0000-0000000000fa', 'cap')$$), 1::bigint,
  'a purchase waits for the pack before it holds the critter');
select is((select coins from extensions.dblink_get_result('member') as t (coins integer)), 88,
  'and goes through once the day close is done');
-- dblink wants one more call, which comes back empty, before the session can send again.
select count(*) from extensions.dblink_get_result('member') as t (x text);

select is(pg_temp.race($$select public.dress_critter('10000000-0000-0000-0000-0000000000fa', 'head', 'cap')$$), 1::bigint,
  'dressing the critter waits for the pack the same way');
select is((select count(*) from extensions.dblink_get_result('member') as t (done text)), 1::bigint,
  'and is done once the day close is');
select count(*) from extensions.dblink_get_result('member') as t (x text);

select pg_temp.clear();
select extensions.dblink_disconnect('close');
select extensions.dblink_disconnect('member');

select * from finish();
rollback;
