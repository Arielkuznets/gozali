-- A pack with nobody in it keeps its photos and captions for weeks, and nobody is there to see who
-- comes in or to remove them. So only someone who was in it can come back, and the first one back is
-- its admin. To anyone else its code is one no pack has: no answer, and a miss on their count, so an
-- old link can't show the pack or take it over (decision D25).
create or replace function public.pack_preview(code text)
returns table (
  pack_id uuid,
  pack_name text,
  category public.habit_category,
  custom_habit text,
  critter jsonb,
  member_count integer,
  member_names text[],
  is_full boolean,
  already_member boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    return;
  end if;
  perform public.check_code_attempts(caller);
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'read_only' using errcode = '25006';
  end if;
  if exists (
    select 1
    from public.pack_members m
    join public.packs p on p.id = m.pack_id
    where p.invite_code = upper(trim(code)) and m.user_id = caller and m.status = 'left' and m.removed_at is not null
  ) then
    raise exception 'removed_from_pack' using errcode = 'P0001';
  end if;
  return query
  select
      p.id,
      p.name,
      p.category,
      p.custom_habit,
      jsonb_build_object(
        'species', c.species, 'name', c.name, 'health', c.health, 'xp', c.xp,
        'stage', c.stage, 'status', c.status, 'streak', c.streak, 'marks', c.marks, 'outfit', c.outfit
      ),
      coalesce(array_length(members.names, 1), 0),
      members.names,
      coalesce(array_length(members.names, 1), 0) >= public.pack_size_limit(),
      exists (
        select 1 from public.pack_members m
        where m.pack_id = p.id and m.user_id = (select auth.uid()) and m.status <> 'left'
      )
    from public.packs p
    join public.critters c on c.pack_id = p.id
    cross join lateral (
      select coalesce(array_agg(coalesce(pr.display_name, '…') order by m.joined_at), '{}') as names
      from public.pack_members m
      join public.profiles pr on pr.id = m.user_id
      where m.pack_id = p.id and m.status <> 'left'
    ) members
    where p.invite_code = upper(trim(code))
      and (
        cardinality(members.names) > 0
        or exists (select 1 from public.pack_members m where m.pack_id = p.id and m.user_id = caller)
      );
  if not found then
    insert into public.code_misses (user_id) values (caller);
  end if;
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
