-- pg_net gave up on a call after 60 seconds, while a close-days run can start packs for 90 and clean
-- up after that, and send-push can pass a minute too. The run carried on and went well, but pg_net
-- had written a timed-out response, which collect_service_errors counts as a failure in the owners'
-- daily summary, and a real failure after that minute went unheard. A call now waits 150 seconds,
-- the longest a function can run, so the answer is the function's own. pg_net's one worker sends
-- nothing new until the calls it started have ended, so a run that long holds up the next push for
-- as long as it runs. Pushes wait in their table meanwhile, so nothing is lost. The other overload
-- only reaches on-report, which answers in seconds.
create or replace function public.call_edge_function(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := (select decrypted_secret from vault.decrypted_secrets where vault.decrypted_secrets.name = 'functions_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where vault.decrypted_secrets.name = 'cron_secret');
begin
  if base_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/' || name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
