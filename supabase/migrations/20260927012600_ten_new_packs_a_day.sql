-- Leaving frees a place among a person's three packs, so a loop of create_pack and leave_pack would
-- make packs without end, each with its critter and member row, until the cleanup of empty packs
-- could no longer finish. So an account starts at most ten packs a day, counting the packs it
-- joins: far more than anyone sets up through the app. The refusal is the one for three packs,
-- which build 4 knows.
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
  if public.active_pack_count(caller) >= public.pack_limit()
    or (select count(*) from public.pack_members m
        where m.user_id = caller and m.joined_at > now() - interval '1 day') >= 10 then
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

-- Packs with nobody in them since 30 days before at_time. A pack whose last member deleted their
-- account has no member rows left, so its creation time stands in. A thousand at a time, the first
-- by id, so the photos a run removes and the packs it drops are the same ones, and a backlog shrinks
-- run by run instead of outgrowing the time limit.
create or replace function public.empty_packs(at_time timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.packs p
  where not exists (select 1 from public.pack_members m where m.pack_id = p.id and m.status <> 'left')
    and coalesce((select max(m.left_at) from public.pack_members m where m.pack_id = p.id), p.created_at)
      < at_time - interval '30 days'
  order by p.id
  limit 1000;
$$;
