-- The developer's email about a report links the photo for 7 days, by its name in storage. Once the
-- 30-day cleanup deletes the file and forgets the name, the poster can upload another image under
-- it, and the link would show that one. So a photo reported in the last 7 days stays until its last
-- report's link has run out.
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
    and not exists (
      select 1 from public.reports r where r.feed_id = f.id and r.created_at > at_time - interval '7 days'
    )
  order by f.created_at
  limit max_rows;
$$;
