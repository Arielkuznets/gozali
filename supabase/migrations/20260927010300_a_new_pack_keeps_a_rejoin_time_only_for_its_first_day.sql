-- A rejoin in the hour between the end of a day and its close keeps the member's time when that takes
-- a feed on that day to keep, in a new pack as in any other. Without one they may have been gone when
-- the day ended, and an older feed would make them started and charge them a miss for it. The one
-- exception is a new pack whose first day hangs on their time: pack_first_day is the day of the
-- second person in, so with fewer than two others from that day or before, moving it would move the
-- first day, which would then never close.
create or replace function public.join_pack(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  target uuid;
  zone text;
  members integer;
  last_closed date;
  open_day date;
begin
  perform 1 from public.profiles where id = caller for no key update;
  perform public.check_code_attempts(caller);
  -- Lock the pack row so two people joining at once cannot both take the last spot.
  select id, timezone into target, zone from public.packs where invite_code = upper(trim(code)) for update;
  if target is null then
    -- No error here: it would undo the recorded miss. The app reads null as "no pack has this code".
    insert into public.code_misses (user_id) values (caller);
    return null;
  end if;

  if exists (select 1 from public.pack_members where pack_id = target and user_id = caller and status <> 'left') then
    return target;
  end if;
  if exists (select 1 from public.pack_members where pack_id = target and user_id = caller and removed_at is not null) then
    raise exception 'removed_from_pack' using errcode = 'P0001';
  end if;

  select count(*) into members from public.pack_members where pack_id = target and status <> 'left';
  -- Before the checks below, whose answers would tell that the code is real.
  if members = 0 and not exists (select 1 from public.pack_members where pack_id = target and user_id = caller) then
    insert into public.code_misses (user_id) values (caller);
    return null;
  end if;
  if members >= public.pack_size_limit() then
    raise exception 'pack_full' using errcode = 'P0001';
  end if;
  if public.active_pack_count(caller) >= public.pack_limit() then
    raise exception 'pack_limit_reached' using errcode = 'P0001';
  end if;

  select max(r.day) into last_closed from public.day_results r where r.pack_id = target;
  open_day := coalesce(last_closed + 1, public.pack_first_day(target));

  insert into public.pack_members (pack_id, user_id, role)
  values (target, caller, case when members = 0 then 'admin'::public.member_role else 'member'::public.member_role end)
  on conflict (pack_id, user_id) do update
    set status = 'active', role = excluded.role, left_at = null,
      joined_at = case
        when members > 0
          and open_day = public.pack_day(zone) - 1
          and public.pack_day(zone, public.pack_members.left_at) >= open_day
          and (
            exists (
              select 1 from public.feeds f
              where f.pack_id = target and f.user_id = caller and f.day = open_day and not f.is_extra
            )
            or (last_closed is null and (
              select count(*) from public.pack_members m
              where m.pack_id = target and m.user_id <> caller and public.pack_day(zone, m.joined_at) <= open_day
            ) < 2)
          )
          then public.pack_members.joined_at
        else now()
      end;
  delete from public.day_passes d where d.pack_id = target and d.day < public.pack_first_day(target);
  return target;
end;
$$;
