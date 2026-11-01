-- claim_notifications drops a nudge that comes due in the receiver's quiet hours, by then already
-- counted as the day's one nudge. It is turned down here instead, by the same rule on the same
-- clock, so the sender hears it at once and still has the nudge for later.
create or replace function public.nudge(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
  local_time timestamp;
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

  select now() at time zone p.timezone into local_time from public.profiles p where p.id = member;
  if extract(hour from local_time) >= 23 or extract(hour from local_time) < 7 then
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
revoke execute on function public.nudge(uuid, uuid) from public, anon;
grant execute on function public.nudge(uuid, uuid) to authenticated;
