-- An egg with nobody else in it on a day waits for a friend, as the screen says, the way it did
-- before a second member first joined. So on such a day only a feed counts its one member: a day
-- without one charges no miss, no rest day and no step toward sleep, and a joker goes back. Nor
-- does the evening reminder ask that member to feed an egg that can't hatch alone.
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
      (pack_date::timestamp + interval '1 day 3 hours') at time zone p.timezone as day_end,
      (select c.status from public.critters c where c.pack_id = p.id) as critter
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
      ) and (
        fed.user_id is not null
        or pack.critter is distinct from 'egg'
        or exists (
          select 1 from public.pack_members o
          where o.pack_id = target and o.user_id <> m.user_id
            and o.joined_at < pack.day_end and (o.left_at is null or o.left_at >= pack.day_end)
        )
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
          and r.day >= public.pack_day(pack.tz, m.joined_at)
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
    and (
      not exists (select 1 from public.critters c where c.pack_id = p.id and c.status = 'egg')
      or exists (
        select 1 from public.pack_members o
        where o.pack_id = p.id and o.user_id <> m.user_id and o.status <> 'left'
      )
    )
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;
