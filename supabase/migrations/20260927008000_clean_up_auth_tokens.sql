-- Each token refresh revokes a row in auth.refresh_tokens and adds another, and nothing else here
-- removes the revoked ones. This is its own job and not a line in clean_up_old_rows: that function is
-- one transaction, so a refusal on Supabase's own table would undo every other cleanup of the night.
--
-- row_security = off turns the silent case into an error: under row level security a delete removes
-- nothing and reports success. plpgsql, so that auth tables that differ on a project fail this job at
-- night and not the migration.
create function public.clean_up_auth_tokens(at_time timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  -- The revoked parent of a live token stays: a phone that never got a refresh's reply comes back
  -- with it and is given the live token, and without the row the phone is signed out.
  delete from auth.refresh_tokens spent
  where spent.revoked
    and spent.updated_at < at_time - interval '2 days'
    and not exists (
      select 1 from auth.refresh_tokens child
      where child.parent = spent.token and not child.revoked
    );
end;
$$;

revoke execute on function public.clean_up_auth_tokens(timestamptz) from public, anon, authenticated;

select cron.schedule('clean-up-auth-tokens', '45 4 * * *', $$select public.clean_up_auth_tokens()$$);
