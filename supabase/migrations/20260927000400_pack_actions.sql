-- Pack actions: create, preview by invite code, join, leave, settings and removing members.
-- Each runs as one transaction inside Postgres (decision D3) and checks its own permissions.

-- Settings that take effect at the start of the next week (spec section 3).
alter table public.packs
  add column pending_rest_days_per_week smallint check (pending_rest_days_per_week between 0 and 4),
  add column pending_week_start public.week_start,
  add column pending_from date,
  add constraint pending_settings_have_date check (
    (pending_rest_days_per_week is null and pending_week_start is null) = (pending_from is null)
  );

create function public.pack_limit() returns integer language sql immutable as $$ select 3 $$;
create function public.pack_size_limit() returns integer language sql immutable as $$ select 8 $$;

-- The pack day a moment belongs to: days run from 03:00 to 03:00 local time (decision D6).
create function public.pack_day(tz text, at_time timestamptz default now())
returns date
language sql
stable
as $$
  select ((at_time at time zone tz) - interval '3 hours')::date;
$$;

create function public.next_week_start(tz text, start public.week_start)
returns date
language sql
stable
as $$
  with today as (select public.pack_day(tz) as day)
  select day
    - (case when start = 'sunday' then extract(dow from day)::int else (extract(dow from day)::int + 6) % 7 end)
    + 7
  from today;
$$;

-- Eight characters from an alphabet without look-alikes, from a secure random source.
create function public.new_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

create function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return caller;
end;
$$;

create function public.active_pack_count(member uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.pack_members where user_id = member and status <> 'left';
$$;

create function public.create_pack(
  pack_name text,
  habit public.habit_category,
  rest_days smallint,
  species public.critter_species,
  critter_color public.critter_color,
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
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = time_zone) then
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

  insert into public.critters (pack_id, species, color) values (created, species, critter_color);
  insert into public.pack_members (pack_id, user_id, role) values (created, caller, 'admin');
  return created;
end;
$$;

-- What someone sees before joining: enough to recognize the pack, nothing private.
create function public.pack_preview(code text)
returns table (
  pack_id uuid,
  pack_name text,
  category public.habit_category,
  custom_habit text,
  species public.critter_species,
  color public.critter_color,
  member_count integer,
  is_full boolean,
  already_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.category,
    p.custom_habit,
    c.species,
    c.color,
    (select count(*)::integer from public.pack_members m where m.pack_id = p.id and m.status <> 'left'),
    (select count(*) from public.pack_members m where m.pack_id = p.id and m.status <> 'left') >= public.pack_size_limit(),
    exists (
      select 1 from public.pack_members m
      where m.pack_id = p.id and m.user_id = (select auth.uid()) and m.status <> 'left'
    )
  from public.packs p
  join public.critters c on c.pack_id = p.id
  where p.invite_code = upper(trim(code))
    and (select auth.uid()) is not null;
$$;

create function public.join_pack(code text)
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
  -- Lock the pack row so two people joining at once cannot both take the last spot.
  select id into target from public.packs where invite_code = upper(trim(code)) for update;
  if target is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.pack_members where pack_id = target and user_id = caller and status <> 'left') then
    return target;
  end if;

  select count(*) into members from public.pack_members where pack_id = target and status <> 'left';
  if members >= public.pack_size_limit() then
    raise exception 'pack_full' using errcode = 'P0001';
  end if;
  if public.active_pack_count(caller) >= public.pack_limit() then
    raise exception 'pack_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.pack_members (pack_id, user_id)
  values (target, caller)
  on conflict (pack_id, user_id) do update
    set status = 'active', role = 'member', left_at = null, joined_at = now();
  return target;
end;
$$;

create function public.leave_pack(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  was_admin boolean;
  successor uuid;
begin
  perform 1 from public.packs where id = target for update;

  select role = 'admin' into was_admin
  from public.pack_members
  where pack_id = target and user_id = caller and status <> 'left';
  if was_admin is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  update public.pack_members
  set status = 'left', left_at = now(), role = 'member'
  where pack_id = target and user_id = caller;

  if was_admin then
    select user_id into successor
    from public.pack_members
    where pack_id = target and status <> 'left'
    order by joined_at, user_id
    limit 1;
    if successor is not null then
      update public.pack_members set role = 'admin' where pack_id = target and user_id = successor;
    end if;
  end if;
end;
$$;

create function public.require_admin(target uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
begin
  if not exists (
    select 1 from public.pack_members
    where pack_id = target and user_id = caller and role = 'admin' and status <> 'left'
  ) then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return caller;
end;
$$;

-- The name changes now; rest days and week start change from the next week start.
create function public.update_pack(
  target uuid,
  pack_name text,
  rest_days smallint,
  starts_on public.week_start
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack public.packs;
begin
  perform public.require_admin(target);
  select * into pack from public.packs where id = target for update;

  update public.packs set name = trim(pack_name) where id = target;

  if rest_days = pack.rest_days_per_week and starts_on = pack.week_start then
    update public.packs
    set pending_rest_days_per_week = null, pending_week_start = null, pending_from = null
    where id = target;
  else
    update public.packs
    set pending_rest_days_per_week = rest_days,
        pending_week_start = starts_on,
        pending_from = public.next_week_start(pack.timezone, pack.week_start)
    where id = target;
  end if;
end;
$$;

create function public.remove_member(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_admin(target);
begin
  if member = caller then
    raise exception 'use_leave_pack' using errcode = '22023';
  end if;
  update public.pack_members
  set status = 'left', left_at = now(), role = 'member'
  where pack_id = target and user_id = member and status <> 'left';
end;
$$;

revoke execute on function public.new_invite_code() from public, anon, authenticated;
revoke execute on function public.require_user() from public, anon;
revoke execute on function public.require_admin(uuid) from public, anon;
revoke execute on function public.active_pack_count(uuid) from public, anon, authenticated;

revoke execute on function public.create_pack(text, public.habit_category, smallint, public.critter_species, public.critter_color, text, text) from public, anon;
revoke execute on function public.pack_preview(text) from public, anon;
revoke execute on function public.join_pack(text) from public, anon;
revoke execute on function public.leave_pack(uuid) from public, anon;
revoke execute on function public.update_pack(uuid, text, smallint, public.week_start) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;

grant execute on function public.create_pack(text, public.habit_category, smallint, public.critter_species, public.critter_color, text, text) to authenticated;
grant execute on function public.pack_preview(text) to authenticated;
grant execute on function public.join_pack(text) to authenticated;
grant execute on function public.leave_pack(uuid) to authenticated;
grant execute on function public.update_pack(uuid, text, smallint, public.week_start) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
