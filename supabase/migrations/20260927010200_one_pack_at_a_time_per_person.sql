-- A person creates or joins one pack at a time. Calls at the same moment each count the packs before
-- the others are in, so they would all pass the limit, and joining locks only the pack it joins.
--
-- The lock is the person's profile row, taken first, for no key update. That mode lets foreign keys
-- through, and foreign keys are all that reach for this row while holding a pack row: the day close,
-- buy_item and a feed all do, and no function changes a profile. So waiting for a pack with this
-- lock in hand can't deadlock with them. Deleting the account takes the profile row first as well.
-- Two people lock two rows, so joining the same pack at once only queues on the pack, as it did.
create or replace function public.create_pack(
  pack_name text,
  habit public.habit_category,
  rest_days smallint,
  species public.critter_species,
  time_zone text,
  habit_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  created uuid;
begin
  perform 1 from public.profiles where id = caller for no key update;
  if public.active_pack_count(caller) >= public.pack_limit() then
    raise exception 'pack_limit_reached' using errcode = 'P0001';
  end if;
  if time_zone = 'America/Coyhaique' then
    time_zone := 'America/Punta_Arenas';
  end if;
  if time_zone like 'posix/%' or time_zone = 'Factory'
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = time_zone) then
    raise exception 'unknown_time_zone' using errcode = '22023';
  end if;

  -- A collision on the invite code is unlikely, but retry instead of failing.
  for attempt in 1..5 loop
    begin
      insert into public.packs (name, category, custom_habit, rest_days_per_week, timezone, invite_code)
      values (trim(pack_name), habit, nullif(trim(habit_text), ''), rest_days, time_zone, public.new_invite_code())
      returning id into created;
      exit;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;

  insert into public.critters (pack_id, species) values (created, species);
  insert into public.pack_members (pack_id, user_id, role) values (created, caller, 'admin');
  return created;
end;
$$;

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
