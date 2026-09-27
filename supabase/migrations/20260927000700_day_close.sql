-- The day close (spec sections 5 and 14). The rules run in TypeScript (packages/game-engine,
-- decision D3) inside the close-days Edge Function; the database gathers each day's input and
-- applies each result in one transaction. Days close in order, once each.

-- Days start closing once a second member joins: from the pack day they joined on.
create function public.pack_first_day(target uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select public.pack_day(p.timezone, second.joined_at)
  from public.packs p
  cross join lateral (
    select m.joined_at from public.pack_members m where m.pack_id = p.id order by m.joined_at offset 1 limit 1
  ) second
  where p.id = target;
$$;

-- Rest days and week start in force on a day: pending settings apply from their start date.
create function public.pack_rules_on(target uuid, pack_date date)
returns table (rest_days smallint, week_start public.week_start, week_from date)
language sql
stable
set search_path = ''
as $$
  with settings as (
    select
      case when p.pending_from <= pack_date then p.pending_rest_days_per_week else p.rest_days_per_week end as rest_days,
      case when p.pending_from <= pack_date then p.pending_week_start else p.week_start end as week_start
    from public.packs p
    where p.id = target
  )
  select
    s.rest_days,
    s.week_start,
    pack_date - case
      when s.week_start = 'sunday' then extract(dow from pack_date)::int
      else (extract(dow from pack_date)::int + 6) % 7
    end
  from settings s;
$$;

-- Rest days a member used in the week of a day, before that day: automatic or declared, from
-- closed days, plus declared rests on days that have not closed yet (the first hour of a day).
create function public.rest_days_used(target uuid, member uuid, pack_date date)
returns integer
language sql
stable
set search_path = ''
as $$
  select (
    select count(*)
    from public.day_results r
    where r.pack_id = target and r.day >= rules.week_from and r.day < pack_date and member = any (r.rested_ids)
  )::integer + (
    select count(*)
    from public.day_passes d
    where d.pack_id = target and d.user_id = member and d.kind = 'rest'
      and d.day >= rules.week_from and d.day < pack_date
      and not exists (select 1 from public.day_results r where r.pack_id = target and r.day = d.day)
  )::integer
  from public.pack_rules_on(target, pack_date) rules;
$$;

-- Packs with a day ready to close at `at_time`, and the first such day.
create function public.packs_to_close(at_time timestamptz default now())
returns table (pack_id uuid, time_zone text, next_day date)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.timezone, next.day
  from public.packs p
  cross join lateral (
    select coalesce(
      (select max(r.day) + 1 from public.day_results r where r.pack_id = p.id),
      public.pack_first_day(p.id)
    ) as day
  ) next
  where next.day is not null and public.day_closes_at(p.timezone, next.day) <= at_time;
$$;

-- Everything the rules need to close one day, shaped like DayInput in the game engine, plus
-- the pack totals before this day and the unlocked achievements.
create function public.day_close_input(target uuid, pack_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with pack as (
    select
      p.timezone as tz,
      (pack_date::timestamp + interval '1 day 3 hours') at time zone p.timezone as day_end
    from public.packs p
    where p.id = target
  ),
  counted_feed as (
    -- Each member's counted feed of the day, with the local minute it happened at. A feed that
    -- counts for an earlier day (the offline rule) is timed by its capture.
    select
      f.user_id,
      (
        (extract(hour from local_time)::int + 21) % 24 * 60 + extract(minute from local_time)::int
      ) as minute
    from public.feeds f
    cross join pack
    cross join lateral (
      select (
        case when f.captured_at is not null and public.pack_day(pack.tz, f.created_at) <> f.day
          then f.captured_at else f.created_at end
      ) at time zone pack.tz as local_time
    ) t
    where f.pack_id = target and f.day = pack_date and not f.is_extra
  ),
  members as (
    select jsonb_build_object(
      'userId', m.user_id,
      'membership', case
        when m.left_at is not null and m.left_at < pack.day_end then 'left'
        when m.status = 'left' then 'active'
        else m.status::text
      end,
      'hasStarted', exists (
        select 1 from public.feeds f
        where f.pack_id = target and f.user_id = m.user_id and not f.is_extra and f.day <= pack_date
      ),
      'paused', exists (
        select 1 from public.pauses s
        where s.pack_id = target and s.user_id = m.user_id and pack_date between s.starts_on and s.ends_on
      ),
      'fedToday', fed.user_id is not null,
      'fedAtMinute', fed.minute,
      'jokerToday', exists (
        select 1 from public.day_passes d
        where d.pack_id = target and d.user_id = m.user_id and d.day = pack_date and d.kind = 'joker'
      ),
      'restDeclaredToday', exists (
        select 1 from public.day_passes d
        where d.pack_id = target and d.user_id = m.user_id and d.day = pack_date and d.kind = 'rest'
      ),
      'restDaysUsedThisWeek', public.rest_days_used(target, m.user_id, pack_date),
      'recentMisses', (
        select count(*)
        from public.day_results r
        where r.pack_id = target
          and r.day between pack_date - 6 and pack_date - 1
          and r.day >= coalesce(m.awake_since, '-infinity'::date)
          and m.user_id = any (r.missed_ids)
      )
    ) as member
    from public.pack_members m
    cross join pack
    left join counted_feed fed on fed.user_id = m.user_id
    where m.pack_id = target and m.joined_at < pack.day_end
  )
  select jsonb_build_object(
    'restDaysPerWeek', (select rest_days from public.pack_rules_on(target, pack_date)),
    'critter', (
      select jsonb_build_object(
        'status', c.status, 'health', c.health, 'xp', c.xp, 'stage', c.stage, 'streak', c.streak,
        'marks', to_jsonb(c.marks)
      )
      from public.critters c where c.pack_id = target
    ),
    'members', coalesce((select jsonb_agg(member) from members), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
        'fullHouseDays', count(*) filter (where r.full_house),
        'earlyBirdDays', count(*) filter (where r.early_bird),
        'nightOwlFeeds', coalesce(sum(r.night_owl_feeds), 0),
        'countedFeeds', (
          select count(*) from public.feeds f where f.pack_id = target and not f.is_extra and f.day < pack_date
        ),
        'members', (
          select count(*) from public.pack_members m where m.pack_id = target and m.status <> 'left'
        )
      )
      from public.day_results r
      where r.pack_id = target and r.day < pack_date
    ),
    'unlocked', coalesce((select jsonb_agg(a.key) from public.achievements a where a.pack_id = target), '[]'::jsonb)
  );
$$;

create function public.outcome_ids(outcomes jsonb, kind text)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array_agg((o ->> 'userId')::uuid), '{}')
  from jsonb_array_elements(outcomes) o
  where o ->> 'outcome' = kind;
$$;

-- Applies one closed day, computed by the game engine: the day_results row, the critter, members
-- who fell asleep, new achievements, the notifications they cause and settings that start now.
-- Returns false when the day was already closed, so running a close twice changes nothing.
create function public.apply_day_result(target uuid, pack_date date, outcome jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_day date;
  critter_after jsonb := outcome -> 'critter';
  outcomes jsonb := outcome -> 'outcomes';
  event jsonb;
  achievement text;
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
    health_before, health_after, early_bird, full_house, night_owl_feeds
  ) values (
    target, pack_date, (outcome ->> 'type')::public.day_type, (outcome ->> 'applied')::boolean,
    public.outcome_ids(outcomes, 'fed'), public.outcome_ids(outcomes, 'rest'), public.outcome_ids(outcomes, 'joker'),
    public.outcome_ids(outcomes, 'paused'), public.outcome_ids(outcomes, 'sleeping'), public.outcome_ids(outcomes, 'missed'),
    (outcome ->> 'healthBefore')::smallint, (critter_after ->> 'health')::smallint,
    (outcome -> 'facts' ->> 'earlyBird')::boolean, (outcome -> 'facts' ->> 'fullHouse')::boolean,
    (outcome -> 'facts' ->> 'nightOwlFeeds')::smallint
  );

  if (outcome ->> 'applied')::boolean then
    update public.critters set
      status = (critter_after ->> 'status')::public.critter_status,
      health = (critter_after ->> 'health')::smallint,
      xp = (critter_after ->> 'xp')::integer,
      stage = (critter_after ->> 'stage')::public.critter_stage,
      streak = (critter_after ->> 'streak')::integer,
      marks = array(select jsonb_array_elements_text(critter_after -> 'marks')),
      hatched_at = coalesce(hatched_at, case when critter_after ->> 'status' <> 'egg' then now() end)
    where pack_id = target;
  end if;

  update public.pack_members set status = 'sleeping'
  where pack_id = target
    and status = 'active'
    and user_id in (select value::uuid from jsonb_array_elements_text(outcome -> 'newlySleeping'));

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
      insert into public.notifications (user_id, pack_id, type, payload)
      values ((event ->> 'userId')::uuid, target, 'still_in', jsonb_build_object('event', 'member_slept'));
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
  update public.packs set
    rest_days_per_week = pending_rest_days_per_week,
    week_start = pending_week_start,
    pending_rest_days_per_week = null,
    pending_week_start = null,
    pending_from = null
  where id = target and pending_from <= pack_date + 1;

  return true;
end;
$$;

-- Old photos: deleted 30 days after posting (spec section 11), except photos a weekly recap
-- collage points to. The close-days function removes the files and then forgets the paths.
create function public.expired_photos(at_time timestamptz default now(), max_rows integer default 500)
returns table (feed_id uuid, photo_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.photo_path
  from public.feeds f
  where f.photo_path is not null
    and f.created_at < at_time - interval '30 days'
    and not exists (select 1 from public.weekly_recaps w where f.id = any (w.feed_ids))
  order by f.created_at
  limit max_rows;
$$;

create function public.forget_photos(feed_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.feeds set photo_path = null where id = any (feed_ids);
$$;

-- The server side only.
revoke execute on function public.pack_first_day(uuid) from public, anon;
revoke execute on function public.pack_rules_on(uuid, date) from public, anon;
revoke execute on function public.rest_days_used(uuid, uuid, date) from public, anon;
revoke execute on function public.packs_to_close(timestamptz) from public, anon, authenticated;
revoke execute on function public.day_close_input(uuid, date) from public, anon, authenticated;
revoke execute on function public.outcome_ids(jsonb, text) from public, anon, authenticated;
revoke execute on function public.apply_day_result(uuid, date, jsonb) from public, anon, authenticated;
revoke execute on function public.expired_photos(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.forget_photos(uuid[]) from public, anon, authenticated;
grant execute on function public.packs_to_close(timestamptz) to service_role;
grant execute on function public.day_close_input(uuid, date) to service_role;
grant execute on function public.apply_day_result(uuid, date, jsonb) to service_role;
grant execute on function public.expired_photos(timestamptz, integer) to service_role;
grant execute on function public.forget_photos(uuid[]) to service_role;
