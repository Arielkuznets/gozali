-- An account keeps at most ten widget tokens, as it does push tokens. A phone makes one and keeps
-- it, so ten covers every phone and tablet with room for reinstalls, while a crafted loop of
-- create_widget_token can't fill the database. A new token replaces the one used longest ago, so a
-- widget that still fetches keeps its token however old it is.
create or replace function public.create_widget_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  delete from public.widget_tokens t
  where t.user_id = caller
    and t.id not in (
      select r.id from public.widget_tokens r
      where r.user_id = caller
      order by coalesce(r.last_used_at, r.created_at) desc, r.id
      limit 9
    );
  insert into public.widget_tokens (user_id, token_hash)
  values (caller, encode(extensions.digest(token, 'sha256'), 'hex'));
  return token;
end;
$$;

-- Accounts with more already keep their ten used most recently.
delete from public.widget_tokens t
where t.id not in (
  select r.id from (
    select id, row_number() over (partition by user_id order by coalesce(last_used_at, created_at) desc, id) as place
    from public.widget_tokens
  ) r
  where r.place <= 10
);
