-- The day close reads a pack's zone with Intl, and Postgres lists names Intl doesn't read: every
-- posix/ name, which no phone reports, and Factory, which is no place and which some Intl builds
-- read and others don't. A pack in one never closes a day, and every run of the close counts as
-- failed, so a pack can't be made in one. America/Coyhaique is a real place whose phones can
-- report it, and the day close's Intl doesn't know it yet: its packs go by America/Punta_Arenas,
-- which has shown the same time since before a new pack can start.
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
