-- A wrong invite code is one miss an hour, however often it is asked for: a join screen left on it
-- asks again at every return to the app and every reconnection, while the person waits for the
-- right code. Guessing still costs a miss for every code tried. The limit counts the codes, so two
-- misses of one code written at the same moment are one too; a miss written before misses had a
-- code counts by itself.
alter table public.code_misses add column code text;

create function public.record_code_miss(caller uuid, tried text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.code_misses (user_id, code)
  select caller, upper(trim(tried))
  where not exists (
    select 1 from public.code_misses m
    where m.user_id = caller and m.code = upper(trim(tried)) and m.at > now() - interval '1 hour'
  );
$$;
revoke execute on function public.record_code_miss(uuid, text) from public, anon, authenticated;

create or replace function public.check_code_attempts(caller uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (
    select count(distinct m.code) + count(*) filter (where m.code is null)
    from public.code_misses m
    where m.user_id = caller and m.at > now() - interval '1 hour'
  ) >= 20 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
end;
$$;

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
  if current_setting('transaction_read_only') = 'on'
    or coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'accept', '') ~* 'pgrst\.object' then
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
    perform public.record_code_miss(caller, code);
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
  perform 1 from public.profiles where id = caller for no key update;
  perform public.check_code_attempts(caller);
  -- Lock the pack row so two people joining at once cannot both take the last spot.
  select id, timezone into target, zone from public.packs where invite_code = upper(trim(code)) for update;
  if target is null then
    -- No error here: it would undo the recorded miss. The app reads null as "no pack has this code".
    perform public.record_code_miss(caller, code);
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
    perform public.record_code_miss(caller, code);
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
