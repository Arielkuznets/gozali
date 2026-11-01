-- A phone forgets its push token by holding it (2026-11-01). One that signs out without a
-- connection, or with a session that has expired, has no session left to delete its row with, and
-- tries again signed out. Only the phone and the account that registered the token know it, so the
-- value is the proof. The answer is the same whether the server held the token or not.
create function public.forget_push_token(device_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = device_token;
$$;

revoke execute on function public.forget_push_token(text) from public;
grant execute on function public.forget_push_token(text) to anon, authenticated;
