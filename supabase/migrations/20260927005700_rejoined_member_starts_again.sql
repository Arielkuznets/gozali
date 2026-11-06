-- A member who rejoins a pack starts again (2026-10-29): until a feed of theirs counts for the day
-- they joined or later, they aren't counted, like a new member, so they can't miss on the day they
-- come back. Feeds for earlier days belong to the old membership; a feed earlier on the day of the
-- rejoin still counts for it. joined_at is the latest join (join_pack sets it).
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
          and f.day >= public.pack_day(pack.tz, m.joined_at)
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

create or replace function public.notify_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid;
  remaining uuid[];
begin
  if new.is_extra then
    return new;
  end if;

  for member in
    select m.user_id from public.pack_members m
    where m.pack_id = new.pack_id and m.status <> 'left' and m.user_id <> new.user_id
      and not exists (select 1 from public.blocks b where b.blocker_id = m.user_id and b.blocked_id = new.user_id)
  loop
    update public.notifications
    set payload = jsonb_set(payload, '{feeders}', (payload -> 'feeders') || to_jsonb(new.user_id))
    where user_id = member and pack_id = new.pack_id and type = 'friend_fed' and status = 'pending';
    if not found then
      insert into public.notifications (user_id, pack_id, type, payload, send_after)
      values (member, new.pack_id, 'friend_fed', jsonb_build_object('feeders', jsonb_build_array(new.user_id)), now() + interval '10 minutes');
    end if;
  end loop;

  -- Counted members who started feeding at some point and haven't fed today.
  select array_agg(m.user_id) into remaining
  from public.pack_members m
  where m.pack_id = new.pack_id
    and public.counted_on(new.pack_id, m.user_id, new.day)
    and not public.fed_on(new.pack_id, m.user_id, new.day)
    and exists (
      select 1 from public.feeds f
      where f.pack_id = new.pack_id and f.user_id = m.user_id and not f.is_extra
        and f.day >= public.pack_day((select p.timezone from public.packs p where p.id = new.pack_id), m.joined_at)
    );
  if cardinality(remaining) = 1 then
    insert into public.notifications (user_id, pack_id, type, day)
    values (remaining[1], new.pack_id, 'last_one', new.day)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
