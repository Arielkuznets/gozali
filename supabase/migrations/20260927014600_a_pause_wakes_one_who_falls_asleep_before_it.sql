-- A pause wakes a sleeper on its first day, a member who falls asleep at the close of the day before
-- it too: the pause wakes them once they have fallen asleep, and they aren't asked "Still in?", since
-- they are awake again and the pause is what they chose.
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
  woke uuid[];
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

  -- A joker covered nobody if the day didn't count its member, so it goes back to them.
  delete from public.day_passes d
  where d.pack_id = target and d.day = pack_date and d.kind = 'joker'
    and d.user_id <> all (public.outcome_ids(outcomes, 'joker'));
  delete from public.day_passes d where d.pack_id = target and d.day < first_day;

  -- Members fall asleep, unless they already fed on a later day (a close that ran late) or joined
  -- again after the day ended, which starts their count of misses over.
  with asleep as (
    update public.pack_members m set status = 'sleeping'
    from public.packs p
    where p.id = target
      and m.pack_id = target
      and m.status = 'active'
      and m.user_id in (select value::uuid from jsonb_array_elements_text(outcome -> 'newlySleeping'))
      and m.joined_at < (pack_date::timestamp + interval '1 day 3 hours') at time zone p.timezone
      and not exists (
        select 1 from public.feeds f
        where f.pack_id = target and f.user_id = m.user_id and f.day > pack_date and not f.is_extra
      )
    returning m.user_id
  )
  select coalesce(array_agg(user_id), '{}') into slept from asleep;

  -- A sleeper's pause starts on the next day, and they wake with their count of misses starting over,
  -- one who fell asleep just now too.
  with woken as (
    update public.pack_members m set status = 'active', awake_since = pack_date + 1
    where m.pack_id = target
      and m.status = 'sleeping'
      and exists (
        select 1 from public.pauses s
        where s.pack_id = target and s.user_id = m.user_id and s.starts_on = pack_date + 1
      )
    returning m.user_id
  )
  select coalesce(array_agg(user_id), '{}') into woke from woken;

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
      if (event ->> 'userId')::uuid = any (slept) and (event ->> 'userId')::uuid <> all (woke) then
        insert into public.notifications (user_id, pack_id, type, payload)
        values ((event ->> 'userId')::uuid, target, 'still_in', jsonb_build_object('event', 'member_slept'));
      end if;
    elsif event ->> 'type' in ('hatched', 'evolved')
      or event ->> 'type' in ('ran_away', 'returned')
      or (
        event ->> 'type' = 'health_state_changed' and event ->> 'to' in ('weak', 'sick') and event ->> 'from' <> 'sick'
      ) then
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
