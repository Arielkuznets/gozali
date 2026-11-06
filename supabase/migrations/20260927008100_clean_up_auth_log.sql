-- The auth server's log keeps an account's email, and its name if it had one, after the account is
-- deleted, and the auth server never trims it. Nothing here reads it, so it keeps 30 days like the
-- other logs. This is its own job and not a line in clean_up_old_rows: that function is one
-- transaction, so a refusal on Supabase's own table would undo every other cleanup of the night.
--
-- row_security = off turns the silent case into an error: under row level security a delete removes
-- nothing and reports success. plpgsql, so that auth tables that differ on a project fail this job at
-- night and not the migration.
create function public.clean_up_auth_log(at_time timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  delete from auth.audit_log_entries where created_at < at_time - interval '30 days';
end;
$$;

revoke execute on function public.clean_up_auth_log(timestamptz) from public, anon, authenticated;

select cron.schedule('clean-up-auth-log', '35 4 * * *', $$select public.clean_up_auth_log()$$);
