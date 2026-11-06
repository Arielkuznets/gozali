-- Turning on a pause used to wake a sleeper at once, awake from the next day; now the close of the day
-- before the pause wakes them. A sleeper who paused today under the old rule goes back to sleep, so
-- cancelling the pause before it starts leaves them asleep, and a pause they keep wakes them on its
-- first day as any pause does. Only the old rule gave a member a waking day after today. A counted
-- feed since the pause, for today or for yesterday while it was still open, woke them under either
-- rule, so that member stays awake.
update public.pack_members m
set status = 'sleeping'
from public.packs p
where p.id = m.pack_id
  and m.status = 'active'
  and m.awake_since > public.pack_day(p.timezone)
  and not exists (
    select 1 from public.feeds f
    where f.pack_id = m.pack_id and f.user_id = m.user_id and not f.is_extra
      and f.day >= public.pack_day(p.timezone) - 1
  );
