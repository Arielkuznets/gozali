-- The weekly recap also says how many coins the pack earned that week (decision D21).

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
