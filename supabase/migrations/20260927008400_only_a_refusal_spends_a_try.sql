-- A try is spent only when the push service turns a notification down. A row that goes back because
-- the service is down or the run ran out of time was never judged: it keeps its tries and comes back
-- after a minute, however long that lasts, so an outage loses nothing and the owners' summary of it
-- goes out with the rest. `refused` names the rows that were turned down, and null means all of
-- them, which is what a function deployed before this migration says by leaving it out.
drop function public.requeue_notifications(uuid[]);

create function public.requeue_notifications(ids uuid[], refused uuid[] default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set status = 'pending', sent_at = null,
      attempts = attempts + case when refused is null or id = any (refused) then 1 else 0 end,
      send_after = now() + case
        when refused is null or id = any (refused) then interval '1 minute' * 2 ^ attempts
        else interval '1 minute'
      end
  where id = any (ids);
$$;

revoke execute on function public.requeue_notifications(uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.requeue_notifications(uuid[], uuid[]) to service_role;
