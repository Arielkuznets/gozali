-- A purchase waits for its pack before it holds the critter, as the day close takes them, so the two
-- can't deadlock. Two more sessions (dblink) play the day close and the purchase; their rows are
-- committed, so they are deleted at the end.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
select plan(2);

-- Through the server's network address: dblink needs a password, and local connections don't ask for one.
create temp table server as
  select format('host=%s port=%s dbname=postgres user=postgres password=postgres', host(inet_server_addr()), inet_server_port()) as dsn;
select extensions.dblink_connect('close', dsn) from server;
select extensions.dblink_connect('shop', dsn) from server;
select extensions.dblink_exec('close', $$
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000fa', 'lock-test@test.local');
  insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
  values ('10000000-0000-0000-0000-0000000000fa', 'Lockers', 'gym', 0, 'UTC', 'WALK5678');
  insert into public.critters (pack_id, species, coins) values ('10000000-0000-0000-0000-0000000000fa', 'kit', 100);
  insert into public.pack_members (pack_id, user_id, role) values ('10000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000fa', 'admin');
$$);

-- The day close holds the pack.
select extensions.dblink_exec('close', 'begin');
select * from extensions.dblink('close', $$select 1 from public.packs where id = '10000000-0000-0000-0000-0000000000fa' for update$$) as t (x integer);

-- A member buys a cap meanwhile.
select extensions.dblink_exec('shop', $$set request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000fa", "role": "authenticated"}'$$);
select extensions.dblink_exec('shop', 'set role authenticated');
select extensions.dblink_exec('shop', $$set lock_timeout = '10s'$$);
select extensions.dblink_send_query('shop', $$select public.buy_item('10000000-0000-0000-0000-0000000000fa', 'cap')$$);
select pg_sleep(0.5);

-- The day close goes on to the critter: free, because the purchase is still waiting for the pack.
select is(
  (select count(*) from extensions.dblink(
    'close', $$select 1 from public.critters where pack_id = '10000000-0000-0000-0000-0000000000fa' for update nowait$$, false
  ) as t (x integer)),
  1::bigint,
  'the purchase waits for the pack before it holds the critter'
);
select extensions.dblink_exec('close', 'rollback');
select is(
  (select coins from extensions.dblink_get_result('shop') as t (coins integer)),
  88,
  'and goes through once the day close is done'
);

select extensions.dblink_exec('close', $$
  delete from public.packs where id = '10000000-0000-0000-0000-0000000000fa';
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000fa';
$$);
select extensions.dblink_disconnect('close');
select extensions.dblink_disconnect('shop');

select * from finish();
rollback;
