-- A nudge is turned down from 22:58 on the receiver's clock, not 23:00: send-push runs every minute
-- and a run can be a minute late, so one accepted later comes due in quiet hours and is dropped,
-- when the sender has already seen Sent! and spent the day's nudge. A sender who used that nudge
-- hears so first, whatever the hour: being told to try after 07:00 would only lead to the same
-- answer, since a pack day can still be open then on a clock far west of the pack's.
create or replace function public.nudge(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
  local_time time;
begin
  if member = caller then
    raise exception 'cannot_nudge_self' using errcode = '22023';
  end if;
  perform public.require_membership(target, member);
  if exists (select 1 from public.blocks b where b.blocker_id = member and b.blocked_id = caller) then
    raise exception 'cannot_nudge' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.feeds f where f.pack_id = target and f.user_id = member and f.day = today and not f.is_extra
  ) then
    raise exception 'already_fed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.day_passes d where d.pack_id = target and d.user_id = member and d.day = today)
    or exists (
      select 1 from public.pauses s where s.pack_id = target and s.user_id = member and today between s.starts_on and s.ends_on
    ) then
    raise exception 'not_counted_today' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.nudges n where n.pack_id = target and n.from_user = caller and n.to_user = member and n.day = today
  ) then
    raise exception 'already_nudged' using errcode = 'P0001';
  end if;

  select (now() at time zone p.timezone)::time into local_time from public.profiles p where p.id = member;
  if local_time >= '22:58' or local_time < '07:00' then
    raise exception 'receiver_quiet' using errcode = 'P0001';
  end if;

  begin
    insert into public.nudges (pack_id, from_user, to_user, day) values (target, caller, member, today);
  exception when unique_violation then
    raise exception 'already_nudged' using errcode = 'P0001';
  end;
  insert into public.notifications (user_id, pack_id, type, payload)
  values (member, target, 'nudge', jsonb_build_object('from', caller));
end;
$$;
