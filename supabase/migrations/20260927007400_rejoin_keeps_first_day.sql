-- A pack's first day comes from when its second member joined, until a day has closed, and a rejoin
-- moves that time. Someone who left and rejoined between the end of a new pack's first day and its
-- close moved the first day up: that day never closed, and the feeds on it, a hatch among them, were
-- lost. Nothing has counted before the first close, so such a rejoin now keeps the time, and the
-- member goes on as if they had stayed. With nobody left in the pack the time still moves: whoever
-- comes back starts it over, rather than closing the days nobody was there.
create or replace function public.join_pack(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  target uuid;
  members integer;
begin
  perform public.check_code_attempts(caller);
  -- Lock the pack row so two people joining at once cannot both take the last spot.
  select id into target from public.packs where invite_code = upper(trim(code)) for update;
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

  insert into public.pack_members (pack_id, user_id, role)
  values (target, caller, case when members = 0 then 'admin'::public.member_role else 'member'::public.member_role end)
  on conflict (pack_id, user_id) do update
    set status = 'active', role = excluded.role, left_at = null,
      joined_at = case
        when members > 0 and not exists (select 1 from public.day_results r where r.pack_id = target)
          then public.pack_members.joined_at
        else now()
      end;
  return target;
end;
$$;
