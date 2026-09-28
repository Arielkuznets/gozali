-- Six creatures, each with its own color, replace three species in six colors (decision D20).
-- Renaming the enum labels keeps every stored critter and every function that uses the type;
-- the color column goes, since the creature decides it.

alter type public.critter_species rename value 'blob' to 'mochi';
alter type public.critter_species rename value 'spark' to 'kit';
alter type public.critter_species rename value 'mossy' to 'ribbit';
alter type public.critter_species add value 'axo' after 'kit';
alter type public.critter_species add value 'hoot' after 'ribbit';
alter type public.critter_species add value 'bun' after 'hoot';

-- Recaps keep a copy of the critter as the week ended.
update public.weekly_recaps
set stats = jsonb_set(
  stats #- '{critter,color}',
  '{critter,species}',
  to_jsonb(case stats #>> '{critter,species}' when 'blob' then 'mochi' when 'spark' then 'kit' when 'mossy' then 'ribbit' else stats #>> '{critter,species}' end)
)
where stats ? 'critter';

drop function public.create_pack(text, public.habit_category, smallint, public.critter_species, public.critter_color, text, text);
alter table public.critters drop column color;
drop type public.critter_color;

create function public.create_pack(
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

  insert into public.critters (pack_id, species) values (created, species);
  insert into public.pack_members (pack_id, user_id, role) values (created, caller, 'admin');
  return created;
end;
$$;

revoke execute on function public.create_pack(text, public.habit_category, smallint, public.critter_species, text, text) from public, anon;
grant execute on function public.create_pack(text, public.habit_category, smallint, public.critter_species, text, text) to authenticated;

-- The same functions as before, without the color.
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
    and (select auth.uid()) is not null;
$$;

create or replace function public.widget_state(token text, at_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  update public.widget_tokens set last_used_at = at_time
  where token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
  returning user_id into owner;
  if owner is null then
    return null;
  end if;

  return jsonb_build_object(
    'timezone', (select pr.timezone from public.profiles pr where pr.id = owner),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'dayEndsAt', public.day_closes_at(p.timezone, today.day) - interval '60 minutes',
        'daysRunning', public.pack_first_day(p.id) is not null,
        'critter', jsonb_build_object(
          'name', c.name, 'species', c.species, 'health', c.health, 'stage', c.stage,
          'status', c.status, 'streak', c.streak, 'marks', to_jsonb(c.marks), 'outfit', c.outfit
        ),
        'iFed', public.fed_on(p.id, owner, today.day),
        -- One entry per member, oldest first, without names.
        'members', (
          select jsonb_agg(
            case
              when public.fed_on(p.id, m.user_id, today.day) then 'fed'
              when m.status = 'sleeping' or exists (
                select 1 from public.pauses s where s.pack_id = p.id and s.user_id = m.user_id and today.day between s.starts_on and s.ends_on
              ) then 'away'
              when exists (
                select 1 from public.day_passes d where d.pack_id = p.id and d.user_id = m.user_id and d.day = today.day
              ) then 'pass'
              else 'waiting'
            end
            order by m.joined_at)
          from public.pack_members m
          where m.pack_id = p.id and m.status <> 'left'
        )
      ) order by p.created_at)
      from public.pack_members mine
      join public.packs p on p.id = mine.pack_id
      join public.critters c on c.pack_id = p.id
      cross join lateral (select public.pack_day(p.timezone, at_time) as day) today
      where mine.user_id = owner and mine.status <> 'left'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_weekly_recap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rules record;
  stats jsonb;
  photos uuid[];
begin
  select * into rules from public.pack_rules_on(new.pack_id, new.day);
  if new.day <> rules.week_from + 6 then
    return null;
  end if;

  with week as (
    select * from public.day_results r
    where r.pack_id = new.pack_id and r.day between rules.week_from and new.day
  ),
  feeders as (
    select member, count(*) as feeds from week, unnest(week.fed_ids) as member group by member
  )
  select jsonb_build_object(
    'weekStart', rules.week_from,
    'weekEnd', new.day,
    'days', (select count(*) from week),
    'successDays', (select count(*) from week where result = 'success'),
    'healthStart', (select health_before from week order by day limit 1),
    'healthEnd', (select health_after from week order by day desc limit 1),
    -- The most consistent members; everyone tied at the top.
    'topMembers', coalesce((
      select jsonb_agg(member) from feeders where feeds = (select max(feeds) from feeders)
    ), '[]'::jsonb),
    'topFeeds', coalesce((select max(feeds) from feeders), 0),
    'achievements', coalesce((
      select jsonb_agg(a.key order by a.unlocked_at)
      from public.achievements a, public.packs p
      where a.pack_id = new.pack_id and p.id = new.pack_id
        and a.unlocked_at >= (rules.week_from::timestamp + interval '3 hours') at time zone p.timezone
        and a.unlocked_at < ((new.day + 1)::timestamp + interval '4 hours') at time zone p.timezone
    ), '[]'::jsonb),
    'critter', (
      select jsonb_build_object(
        'name', c.name, 'species', c.species, 'stage', c.stage, 'status', c.status,
        'health', c.health, 'streak', c.streak, 'marks', to_jsonb(c.marks), 'outfit', c.outfit
      )
      from public.critters c where c.pack_id = new.pack_id
    )
  ) into stats;

  -- Up to 9 photos for the collage, one per member before a second from anyone.
  select array_agg(id order by turn, created_at desc) into photos
  from (
    select f.id, f.created_at, row_number() over (partition by f.user_id order by f.is_extra, f.created_at desc) as turn
    from public.feeds f
    where f.pack_id = new.pack_id and f.day between rules.week_from and new.day
      and f.photo_path is not null and f.hidden_at is null
    order by turn, f.created_at desc
    limit 9
  ) picked;

  insert into public.weekly_recaps (pack_id, week_start, stats, feed_ids)
  values (new.pack_id, rules.week_from, stats, coalesce(photos, '{}'))
  on conflict do nothing;
  if found then
    insert into public.notifications (user_id, pack_id, type, payload)
    select m.user_id, new.pack_id, 'weekly_recap', jsonb_build_object('weekStart', rules.week_from)
    from public.pack_members m where m.pack_id = new.pack_id and m.status <> 'left';
  end if;
  return null;
end;
$$;
