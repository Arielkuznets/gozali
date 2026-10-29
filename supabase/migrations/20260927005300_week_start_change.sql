-- When a pack's week starts on another day (decision D24): the running week ends as planned, with
-- its recap, and the days until the new start day comes round join the first week under it. That
-- week is longer, 8 or 13 days, and allows rest days in proportion, rounded up, so the change
-- costs nobody a rest. Rest days count within the week their day belongs to.

-- The first day of the first week under the current week start, when the pack changed it.
alter table public.packs add column week_changed_on date;

-- The week each day belonged to when it closed. Older days don't have it.
alter table public.day_results add column week_from date, add column week_to date;

-- Days since the last start day, 0 on the start day itself.
create function public.days_into_week(start public.week_start, pack_date date)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when start = 'sunday' then extract(dow from pack_date)::int else (extract(dow from pack_date)::int + 6) % 7 end;
$$;

-- The week a day belongs to, for weeks that start on `start` and, from `changed_on` on, a first
-- week that runs from that day to the end of the first full week after it.
create function public.week_of(start public.week_start, changed_on date, pack_date date)
returns table (week_from date, week_to date)
language sql
immutable
set search_path = ''
as $$
  with usual as (
    select pack_date - public.days_into_week(start, pack_date) as week_from
  ),
  week as (
    select case
      when changed_on <= pack_date and u.week_from < changed_on + 7 then changed_on
      else u.week_from
    end as week_from
    from usual u
  )
  select w.week_from, w.week_from + 6 - public.days_into_week(start, w.week_from + 6) + 6
  from week w;
$$;

-- The week of a day in a pack and the rest days it allows: pending settings apply from their
-- first day, and a new start day changes the weeks from there.
create function public.pack_week_on(target uuid, pack_date date)
returns table (rest_days smallint, week_start public.week_start, week_from date, week_to date)
language sql
stable
set search_path = ''
as $$
  with settings as (
    select
      case when p.pending_from <= pack_date then p.pending_rest_days_per_week else p.rest_days_per_week end as rest_days,
      case when p.pending_from <= pack_date then p.pending_week_start else p.week_start end as week_start,
      case
        when p.pending_from <= pack_date and p.pending_week_start <> p.week_start then p.pending_from
        else p.week_changed_on
      end as changed_on
    from public.packs p
    where p.id = target
  )
  select ceil(s.rest_days * (w.week_to - w.week_from + 1) / 7.0)::smallint, s.week_start, w.week_from, w.week_to
  from settings s
  cross join lateral public.week_of(s.week_start, s.changed_on, pack_date) w;
$$;

-- Rest days the week of a day allows, its start day and its first day (pack_week_on).
create or replace function public.pack_rules_on(target uuid, pack_date date)
returns table (rest_days smallint, week_start public.week_start, week_from date)
language sql
stable
set search_path = ''
as $$
  select w.rest_days, w.week_start, w.week_from from public.pack_week_on(target, pack_date) w;
$$;

-- Pending settings whose first day is `pack_date` or earlier become the pack's own.
create function public.fold_pending_settings(target uuid, pack_date date)
returns void
language sql
set search_path = ''
as $$
  update public.packs set
    rest_days_per_week = pending_rest_days_per_week,
    week_start = pending_week_start,
    week_changed_on = case when pending_week_start <> week_start then pending_from else week_changed_on end,
    pending_rest_days_per_week = null,
    pending_week_start = null,
    pending_from = null
  where id = target and pending_from <= pack_date;
$$;

-- A closing day keeps its week as the settings stand before the close moves the pack to new
-- ones: the recap, made at commit, goes by it.
create function public.set_day_week()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select w.week_from, w.week_to into new.week_from, new.week_to from public.pack_week_on(new.pack_id, new.day) w;
  return new;
end;
$$;

create trigger day_week before insert on public.day_results
  for each row execute function public.set_day_week();

create or replace function public.apply_day_result(target uuid, pack_date date, outcome jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_day date;
  critter_after jsonb := outcome -> 'critter';
  outcomes jsonb := outcome -> 'outcomes';
  earned integer := coalesce((outcome ->> 'coins')::integer, 0);
  event jsonb;
  achievement text;
  slept uuid[];
begin
  -- One close per pack at a time.
  perform 1 from public.packs where id = target for update;
  if not found then
    raise exception 'pack_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.day_results r where r.pack_id = target and r.day = pack_date) then
    return false;
  end if;
  first_day := public.pack_first_day(target);
  if first_day is null or pack_date < first_day then
    raise exception 'day_not_open' using errcode = 'P0001';
  end if;
  if pack_date > first_day
    and not exists (select 1 from public.day_results r where r.pack_id = target and r.day = pack_date - 1) then
    raise exception 'previous_day_open' using errcode = 'P0001';
  end if;

  insert into public.day_results (
    pack_id, day, result, applied, fed_ids, rested_ids, joker_ids, paused_ids, sleeping_ids, missed_ids,
    health_before, health_after, early_bird, full_house, night_owl_feeds, coins
  ) values (
    target, pack_date, (outcome ->> 'type')::public.day_type, (outcome ->> 'applied')::boolean,
    public.outcome_ids(outcomes, 'fed'), public.outcome_ids(outcomes, 'rest'), public.outcome_ids(outcomes, 'joker'),
    public.outcome_ids(outcomes, 'paused'), public.outcome_ids(outcomes, 'sleeping'), public.outcome_ids(outcomes, 'missed'),
    (outcome ->> 'healthBefore')::smallint, (critter_after ->> 'health')::smallint,
    (outcome -> 'facts' ->> 'earlyBird')::boolean, (outcome -> 'facts' ->> 'fullHouse')::boolean,
    (outcome -> 'facts' ->> 'nightOwlFeeds')::smallint, earned
  );

  if (outcome ->> 'applied')::boolean then
    update public.critters set
      status = (critter_after ->> 'status')::public.critter_status,
      health = (critter_after ->> 'health')::smallint,
      xp = (critter_after ->> 'xp')::integer,
      stage = (critter_after ->> 'stage')::public.critter_stage,
      streak = (critter_after ->> 'streak')::integer,
      marks = array(select jsonb_array_elements_text(critter_after -> 'marks')),
      coins = coins + earned,
      hatched_at = coalesce(hatched_at, case when critter_after ->> 'status' <> 'egg' then now() end)
    where pack_id = target;
  end if;

  -- Members fall asleep, unless they already fed on a later day (a close that ran late).
  with asleep as (
    update public.pack_members m set status = 'sleeping'
    where m.pack_id = target
      and m.status = 'active'
      and m.user_id in (select value::uuid from jsonb_array_elements_text(outcome -> 'newlySleeping'))
      and not exists (
        select 1 from public.feeds f
        where f.pack_id = target and f.user_id = m.user_id and f.day > pack_date and not f.is_extra
      )
    returning m.user_id
  )
  select coalesce(array_agg(user_id), '{}') into slept from asleep;

  for achievement in select value from jsonb_array_elements_text(coalesce(outcome -> 'achievements', '[]'::jsonb)) loop
    insert into public.achievements (pack_id, key) values (target, achievement::public.achievement_key)
    on conflict do nothing;
    insert into public.notifications (user_id, pack_id, type, payload)
    select m.user_id, target, 'evolution', jsonb_build_object('event', 'achievement', 'key', achievement)
    from public.pack_members m where m.pack_id = target and m.status <> 'left';
  end loop;

  -- Notifications go to the outbox in this same transaction (spec section 14).
  for event in select value from jsonb_array_elements(outcome -> 'events') loop
    if event ->> 'type' = 'member_slept' then
      if (event ->> 'userId')::uuid = any (slept) then
        insert into public.notifications (user_id, pack_id, type, payload)
        values ((event ->> 'userId')::uuid, target, 'still_in', jsonb_build_object('event', 'member_slept'));
      end if;
    elsif event ->> 'type' in ('hatched', 'evolved')
      or event ->> 'type' in ('ran_away', 'returned')
      or (event ->> 'type' = 'health_state_changed' and event ->> 'to' in ('weak', 'sick')) then
      insert into public.notifications (user_id, pack_id, type, payload)
      select m.user_id, target,
        case when event ->> 'type' in ('hatched', 'evolved') then 'evolution' else 'pet_state' end::public.notification_type,
        jsonb_build_object('event', event ->> 'type') || (event - 'type')
      from public.pack_members m where m.pack_id = target and m.status <> 'left';
    end if;
  end loop;

  -- Rest days and week start chosen for the next week take over once their first day is next.
  perform public.fold_pending_settings(target, pack_date + 1);

  return true;
end;
$$;

create or replace function public.create_weekly_recap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stats jsonb;
  photos uuid[];
begin
  if new.week_to is distinct from new.day then
    return null;
  end if;

  with week as (
    select * from public.day_results r
    where r.pack_id = new.pack_id and r.day between new.week_from and new.day
  ),
  feeders as (
    select member, count(*) as feeds from week, unnest(week.fed_ids) as member group by member
  )
  select jsonb_build_object(
    'weekStart', new.week_from,
    'weekEnd', new.day,
    'days', (select count(*) from week),
    'successDays', (select count(*) from week where result = 'success'),
    'healthStart', (select health_before from week order by day limit 1),
    'healthEnd', (select health_after from week order by day desc limit 1),
    'coins', (select coalesce(sum(coins), 0) from week),
    -- The most consistent members; everyone tied at the top.
    'topMembers', coalesce((
      select jsonb_agg(member) from feeders where feeds = (select max(feeds) from feeders)
    ), '[]'::jsonb),
    'topFeeds', coalesce((select max(feeds) from feeders), 0),
    'achievements', coalesce((
      select jsonb_agg(a.key order by a.unlocked_at)
      from public.achievements a, public.packs p
      where a.pack_id = new.pack_id and p.id = new.pack_id
        and a.unlocked_at >= (new.week_from::timestamp + interval '3 hours') at time zone p.timezone
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
    where f.pack_id = new.pack_id and f.day between new.week_from and new.day
      and f.photo_path is not null and f.hidden_at is null
    order by turn, f.created_at desc
    limit 9
  ) picked;

  insert into public.weekly_recaps (pack_id, week_start, stats, feed_ids)
  values (new.pack_id, new.week_from, stats, coalesce(photos, '{}'))
  on conflict do nothing;
  if found then
    insert into public.notifications (user_id, pack_id, type, payload)
    select m.user_id, new.pack_id, 'weekly_recap', jsonb_build_object('weekStart', new.week_from)
    from public.pack_members m where m.pack_id = new.pack_id and m.status <> 'left';
  end if;
  return null;
end;
$$;

-- New rest days and week start apply from the day after the running week ends.
create or replace function public.update_pack(
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
  today date;
begin
  perform public.require_admin(target);
  select * into pack from public.packs where id = target for update;
  today := public.pack_day(pack.timezone);

  update public.packs set name = trim(pack_name) where id = target;

  if rest_days = pack.rest_days_per_week and starts_on = pack.week_start then
    update public.packs
    set pending_rest_days_per_week = null, pending_week_start = null, pending_from = null
    where id = target;
  else
    update public.packs
    set pending_rest_days_per_week = rest_days,
        pending_week_start = starts_on,
        pending_from = (select w.week_to + 1 from public.week_of(pack.week_start, pack.week_changed_on, today) w)
    where id = target;
  end if;
end;
$$;

-- update_pack was its only caller.
drop function public.next_week_start(text, public.week_start);

revoke execute on function public.days_into_week(public.week_start, date) from public, anon, authenticated;
revoke execute on function public.week_of(public.week_start, date, date) from public, anon, authenticated;
revoke execute on function public.pack_week_on(uuid, date) from public, anon, authenticated;
revoke execute on function public.fold_pending_settings(uuid, date) from public, anon, authenticated;
revoke execute on function public.set_day_week() from public, anon, authenticated;
