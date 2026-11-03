-- A row nobody judged may be on the phones all the same: Expo can take a batch and lose its answer,
-- and each time such a row goes back it goes out again. So it waits half as long as it has been
-- around, at least a minute and at most half an hour, which makes the wait grow with each return
-- without a count kept on the row. It still spends no try and is never dropped for this, so an
-- outage loses nothing, and what is left when it ends goes out within the half hour.
create or replace function public.requeue_notifications(ids uuid[], refused uuid[] default null)
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
        else greatest(interval '1 minute', least((now() - created_at) / 2, interval '30 minutes'))
      end
  where id = any (ids);
$$;
