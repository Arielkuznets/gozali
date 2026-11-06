-- A rejoin starts a member again: they count from that moment, can't miss on the day they return,
-- and a feed from before doesn't make them started. The exception is the hour between the end of a
-- day and its close, when that day is still open. Someone who left on or after it and is back
-- before it closes goes on as if they had stayed, so their feed on it counts, which can be what
-- hatches the egg, and in a new pack the first day stays put, or it would never close. In a pack
-- that has closed a day, that takes a feed to keep: without one they may have been gone when the
-- day ended or asleep, and coming back as active would turn that into a miss. With nobody left in
-- the pack the time always moves: whoever comes back starts it over.
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
          and (last_closed is null or exists (
            select 1 from public.feeds f
            where f.pack_id = target and f.user_id = caller and f.day = open_day and not f.is_extra
          ))
          then public.pack_members.joined_at
        else now()
      end;
  delete from public.day_passes d where d.pack_id = target and d.day < public.pack_first_day(target);
  return target;
end;
$$;
