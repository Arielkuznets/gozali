-- A row that goes back without an answer waits half its age, in case Expo took it and only the answer
-- was lost. A row the run never offered Expo, because an earlier request failed or time ran out, or
-- that Expo got only in a request it turned down whole, is on no phone, so it comes back in a minute
-- however old it is. `unsent` names those rows and spends no try. A function deployed before this
-- migration leaves it out, and its rows wait as they did.
drop function public.requeue_notifications(uuid[], uuid[]);

create function public.requeue_notifications(ids uuid[], refused uuid[] default null, unsent uuid[] default null)
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
        when id = any (unsent) then interval '1 minute'
        else greatest(interval '1 minute', least((now() - created_at) / 2, interval '30 minutes'))
      end
  where id = any (ids);
$$;

revoke execute on function public.requeue_notifications(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.requeue_notifications(uuid[], uuid[], uuid[]) to service_role;
