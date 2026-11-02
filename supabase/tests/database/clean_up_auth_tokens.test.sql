-- Spent refresh tokens go after two days. A live token stays, and so does the revoked parent of a
-- live one: a phone that never got a refresh's reply comes back with it and is given the live token.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.refresh_tokens (token, user_id, revoked, parent, created_at, updated_at) values
  ('spent-2-days', 'clean-up-test', true, null, now() - interval '9 days', now() - interval '49 hours'),
  ('spent-today', 'clean-up-test', true, null, now() - interval '9 days', now() - interval '47 hours'),
  ('live-old', 'clean-up-test', false, null, now() - interval '9 days', now() - interval '9 days'),
  ('lost-reply', 'clean-up-test', true, null, now() - interval '9 days', now() - interval '9 days'),
  ('live-child', 'clean-up-test', false, 'lost-reply', now() - interval '9 days', now() - interval '9 days'),
  ('chain-parent', 'clean-up-test', true, null, now() - interval '9 days', now() - interval '9 days'),
  ('chain-child', 'clean-up-test', true, 'chain-parent', now() - interval '9 days', now() - interval '9 days');

select is(
  (select count(*) from cron.job where jobname = 'clean-up-auth-tokens' and active), 1::bigint,
  'the cleanup is scheduled'
);
select lives_ok(
  coalesce((select command from cron.job where jobname = 'clean-up-auth-tokens'), 'select 1'),
  'its command runs'
);

create function pg_temp.has_token(wanted text) returns boolean language sql as $$
  select exists (select 1 from auth.refresh_tokens where token = wanted)
$$;
select ok(not pg_temp.has_token('spent-2-days'), 'a token revoked over two days ago goes');
select ok(pg_temp.has_token('spent-today'), 'one revoked less than two days ago stays, however old it is');
select ok(pg_temp.has_token('live-old'), 'a live token stays, however old it is');
select ok(pg_temp.has_token('lost-reply'), 'the revoked parent of a live token stays');
select ok(pg_temp.has_token('live-child'), 'and so does that live token');
select ok(
  not pg_temp.has_token('chain-parent') and not pg_temp.has_token('chain-child'),
  'a revoked parent whose child is revoked too goes with it'
);

select ok(
  (select proconfig @> array['row_security=off'] from pg_proc where proname = 'clean_up_auth_tokens'),
  'a role under row level security gets an error, not a delete of nothing'
);
select ok(
  not has_function_privilege('anon', 'public.clean_up_auth_tokens(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.clean_up_auth_tokens(timestamptz)', 'execute'),
  'the app can''t call it'
);

select * from finish();
rollback;
