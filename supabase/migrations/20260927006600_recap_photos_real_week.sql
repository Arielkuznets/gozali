-- A recap collage photo stays 8 weeks after its week, and a week runs 8 or 13 days when a pack
-- changes its first day of the week. The recap's stats hold the week's real last day, so the 8 weeks
-- count from there. A recap without it is a 7-day week.
create or replace function public.expired_photos(at_time timestamptz default now(), max_rows integer default 500)
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
    and not exists (
      select 1 from public.weekly_recaps w
      where w.pack_id = f.pack_id
        and f.id = any (w.feed_ids)
        and coalesce((w.stats ->> 'weekEnd')::date, w.week_start + 6) + 1 > (at_time - interval '8 weeks')::date
    )
  order by f.created_at
  limit max_rows;
$$;
