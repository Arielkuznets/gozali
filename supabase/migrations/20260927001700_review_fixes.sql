-- Fixes from the code review of Sep 27, 2026.

-- 1. A push token belongs to a device, not to an account: when someone else signs in on the
-- phone, the token moves to them. The table's own policy only lets a member change their own
-- rows, so the old owner's row blocked the move and their notifications kept arriving there.
create function public.register_push_token(device_token text, device public.push_platform)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
begin
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (device_token, caller, device, now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;
revoke execute on function public.register_push_token(text, public.push_platform) from public, anon;
grant execute on function public.register_push_token(text, public.push_platform) to authenticated;

-- 2. Members write their own time zone and notification choices, and the notification jobs read
-- them for everyone at once, so one bad value must not break the jobs. An unknown time zone
-- becomes UTC (a phone can report a name Postgres doesn't know), and the choices stay an object;
-- a choice is off only when it is exactly false.
create function public.clean_profile_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    new.timezone := 'UTC';
  end if;
  if jsonb_typeof(new.notification_prefs) is distinct from 'object' then
    new.notification_prefs := '{}'::jsonb;
  end if;
  return new;
end;
$$;
revoke execute on function public.clean_profile_settings() from public, anon, authenticated;
create trigger clean_profile_settings before insert or update of timezone, notification_prefs on public.profiles
  for each row execute function public.clean_profile_settings();

create function public.wants(prefs jsonb, kind text)
returns boolean
language sql
immutable
as $$
  select coalesce(prefs ->> kind, 'true') <> 'false';
$$;

create or replace function public.queue_evening_reminders(at_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  insert into public.notifications (user_id, pack_id, type, day)
  select m.user_id, p.id, 'evening_reminder', t.pack_date
  from public.packs p
  join public.pack_members m on m.pack_id = p.id and m.status = 'active'
  join public.profiles pr on pr.id = m.user_id
  cross join lateral (
    select
      public.pack_day(p.timezone, at_time) as pack_date,
      public.day_closes_at(p.timezone, public.pack_day(p.timezone, at_time)) - interval '60 minutes' as day_end
  ) t
  cross join lateral (
    select ((t.pack_date::timestamp + pr.reminder_time) at time zone pr.timezone) as wanted
  ) w
  cross join lateral (
    select case
      when w.wanted < t.day_end - interval '1 day' or w.wanted >= t.day_end then t.day_end - interval '2 hours'
      else w.wanted
    end as remind_at
  ) r
  where public.pack_first_day(p.id) is not null
    and at_time >= r.remind_at
    and at_time < t.day_end
    and public.wants(pr.notification_prefs, 'evening_reminder')
    and public.counted_on(p.id, m.user_id, t.pack_date)
    and not public.fed_on(p.id, m.user_id, t.pack_date)
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

-- Same rules as before, plus: a notification about a pack the member has left is dropped, and a
-- row that fails for any reason is dropped instead of stopping the whole run.
create or replace function public.claim_notifications(at_time timestamptz default now(), max_rows integer default 200)
returns table (
  id uuid,
  user_id uuid,
  pack_id uuid,
  type public.notification_type,
  payload jsonb,
  locale text,
  pack_name text,
  critter_name text,
  species public.critter_species,
  names text[],
  tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n record;
  local_time timestamp;
  pack_date date;
  sent_today integer;
  decision text;
begin
  for n in
    select x.*, pr.timezone as user_tz, pr.locale as user_locale, pr.notification_prefs as prefs, p.timezone as pack_tz
    from public.notifications x
    join public.profiles pr on pr.id = x.user_id
    left join public.packs p on p.id = x.pack_id
    where x.status = 'pending' and x.send_after <= at_time
    order by x.send_after
    limit max_rows
    for update of x skip locked
  loop
    begin
      local_time := at_time at time zone n.user_tz;
      pack_date := coalesce(n.day, public.pack_day(coalesce(n.pack_tz, n.user_tz), at_time));
      decision := 'send';

      if not public.wants(n.prefs, n.type::text) then
        decision := 'drop';
      elsif n.pack_id is not null and not exists (
        select 1 from public.pack_members m where m.pack_id = n.pack_id and m.user_id = n.user_id and m.status <> 'left'
      ) then
        decision := 'drop';
      elsif extract(hour from local_time) >= 23 or extract(hour from local_time) < 7 then
        decision := case when public.keeps_overnight(n.type) then 'wait' else 'drop' end;
      elsif n.type in ('evening_reminder', 'last_one', 'nudge') and (
        not public.counted_on(n.pack_id, n.user_id, pack_date) or public.fed_on(n.pack_id, n.user_id, pack_date)
      ) then
        decision := 'drop';
      elsif n.type not in ('evening_reminder', 'last_one', 'friend_fed') then
        select count(*) into sent_today
        from public.notifications s
        where s.user_id = n.user_id and s.status = 'sent' and s.type <> 'friend_fed'
          and s.sent_at >= at_time - interval '1 day'
          and (s.sent_at at time zone n.user_tz)::date = local_time::date;
        if sent_today >= 6 then
          decision := 'drop';
        end if;
      end if;
    exception when others then
      decision := 'drop';
    end;

    if decision = 'wait' then
      update public.notifications x
      set send_after = (
        (local_time::date + case when extract(hour from local_time) >= 23 then 1 else 0 end)::timestamp
        + interval '7 hours'
      ) at time zone n.user_tz
      where x.id = n.id;
    elsif decision = 'drop' then
      update public.notifications x set status = 'dropped' where x.id = n.id;
    else
      update public.notifications x set status = 'sent', sent_at = at_time where x.id = n.id;
      return query
      select
        n.id, n.user_id, n.pack_id, n.type, n.payload, n.user_locale,
        (select p.name from public.packs p where p.id = n.pack_id),
        (select c.name from public.critters c where c.pack_id = n.pack_id),
        (select c.species from public.critters c where c.pack_id = n.pack_id),
        (
          select coalesce(array_agg(coalesce(pr.display_name, '...') order by who.position), '{}')
          from jsonb_array_elements_text(
            coalesce(n.payload -> 'feeders', '[]'::jsonb) || coalesce(to_jsonb(n.payload ->> 'from'), '[]'::jsonb)
          ) with ordinality as who (member, position)
          join public.profiles pr on pr.id::text = who.member
        ),
        (select coalesce(array_agg(t.token), '{}') from public.push_tokens t where t.user_id = n.user_id);
    end if;
  end loop;
end;
$$;

-- The daily cap looks at what a member was sent in the last day.
create index notifications_sent_by_user on public.notifications (user_id, sent_at) where status = 'sent';

-- 3. Catching up on missed days. A member who fell asleep and woke up again before a late
-- close runs was asleep on the days in between (awake_since is after them), and a close must
-- not put back to sleep a member who already fed on a later day.
create or replace function public.day_close_input(target uuid, pack_date date)
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
        when m.status = 'sleeping' or m.awake_since > pack_date then 'sleeping'
        else 'active'
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

-- 4. A pack nobody is in any more stops closing days (if someone rejoins, the close catches up).
create or replace function public.packs_to_close(at_time timestamptz default now())
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
  where next.day is not null
    and public.day_closes_at(p.timezone, next.day) <= at_time
    and exists (select 1 from public.pack_members m where m.pack_id = p.id and m.status <> 'left');
$$;

-- 5. Housekeeping once a day: old sent or dropped notifications, and widget tokens no device
-- has used for 90 days (a reinstall leaves the old one behind).
create function public.clean_up_old_rows(at_time timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.notifications where status <> 'pending' and created_at < at_time - interval '30 days';
  delete from public.widget_tokens where coalesce(last_used_at, created_at) < at_time - interval '90 days';
$$;
revoke execute on function public.clean_up_old_rows(timestamptz) from public, anon, authenticated;
select cron.schedule('clean-up', '30 4 * * *', $$select public.clean_up_old_rows()$$);

-- 6. Extra posts are for sharing more of the day, not for flooding the feed: five a day.
create or replace function public.submit_feed(
  target uuid,
  photo text,
  note text default null,
  taken_at timestamptz default null,
  focus smallint default null,
  extra boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  pack_tz text;
  standing public.member_status;
  counted_day date;
  created uuid;
begin
  select p.timezone, m.status into pack_tz, standing
  from public.packs p
  join public.pack_members m on m.pack_id = p.id and m.user_id = caller
  where p.id = target;
  if pack_tz is null or standing = 'left' then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if split_part(photo, '/', 1) <> target::text
    or split_part(photo, '/', 2) <> caller::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'feed-photos' and o.name = photo) then
    raise exception 'photo_missing' using errcode = 'P0001';
  end if;

  note := nullif(trim(note), '');
  counted_day := public.feed_day(pack_tz, now(), taken_at);
  -- A day that already closed takes no more feeds; count it for the current day instead.
  if exists (select 1 from public.day_results r where r.pack_id = target and r.day = counted_day) then
    counted_day := public.pack_day(pack_tz);
  end if;

  -- An extra post before the day's counted feed is the counted feed.
  if extra and not exists (
    select 1 from public.feeds f
    where f.pack_id = target and f.user_id = caller and f.day = counted_day and not f.is_extra
  ) then
    extra := false;
  end if;

  if extra then
    if (
      select count(*) from public.feeds f
      where f.pack_id = target and f.user_id = caller and f.day = counted_day and f.is_extra
    ) >= 5 then
      raise exception 'too_many_posts' using errcode = 'P0001';
    end if;
    insert into public.feeds (pack_id, user_id, photo_path, caption, day, is_extra, focus_minutes, captured_at)
    values (target, caller, photo, note, counted_day, true, focus, taken_at)
    returning id into created;
    return created;
  end if;

  begin
    insert into public.feeds (pack_id, user_id, photo_path, caption, day, focus_minutes, captured_at)
    values (target, caller, photo, note, counted_day, focus, taken_at)
    returning id into created;
  exception when unique_violation then
    -- The unique index lets only one counted feed per day through, even from a double tap.
    raise exception 'already_fed' using errcode = 'P0001';
  end;

  -- Feeding wakes a sleeping member, who counts on this same day.
  update public.pack_members
  set status = 'active', awake_since = counted_day
  where pack_id = target and user_id = caller and status = 'sleeping';

  -- Feeding cancels today's joker or declared rest, which goes back to the member.
  delete from public.day_passes
  where pack_id = target and user_id = caller and day = counted_day;

  return created;
end;
$$;
