-- An account keeps at most ten widget tokens: a new one replaces the one used longest ago.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a2', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000005b2', 'dan@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
create temp table made (n integer, token text);
-- Makes tokens for the caller an hour apart, the first one oldest (in a test everything happens at
-- the same now()).
create function pg_temp.make_tokens(first integer, last integer) returns void language plpgsql as $$
declare
  token text;
begin
  for n in first..last loop
    token := public.create_widget_token();
    insert into made values (n, token);
    update public.widget_tokens set created_at = now() - make_interval(hours => 20 - n)
    where token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
  end loop;
end;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000005b2');
select pg_temp.make_tokens(0, 0);
select pg_temp.act_as('00000000-0000-0000-0000-0000000005a2');
select pg_temp.make_tokens(1, 10);
-- The first phone's widget is still in use.
select public.widget_state((select token from made where n = 1));
select pg_temp.make_tokens(11, 12);

select is(
  (select count(*) from public.widget_tokens where user_id = '00000000-0000-0000-0000-0000000005a2'),
  10::bigint,
  'twelve tokens leave ten'
);
select is(public.widget_state((select token from made where n = 2)), null, 'the one used longest ago is gone');
select is(public.widget_state((select token from made where n = 3)), null, 'and the next one');
select isnt(public.widget_state((select token from made where n = 1)), null, 'a token in use stays, however old');
select isnt(public.widget_state((select token from made where n = 12)), null, 'the newest works');
select isnt(public.widget_state((select token from made where n = 0)), null, 'another account''s token is left alone');

select * from finish();
rollback;
