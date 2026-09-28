-- Runs the close-days Edge Function every 15 minutes (spec section 14). The function's address
-- and the shared secret live in Vault, so they never sit in a migration; until both secrets
-- exist (locally, or before the cloud project is set up) the job does nothing. Setup:
--   select vault.create_secret('https://<project>.supabase.co/functions/v1/close-days', 'close_days_url');
--   select vault.create_secret('<secret>', 'cron_secret');
-- and give the function the same secret: npx supabase secrets set CRON_SECRET=<secret>
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function public.call_close_days()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'close_days_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if target_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := target_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.call_close_days() from public, anon, authenticated;

select cron.schedule('close-days', '*/15 * * * *', 'select public.call_close_days()');
