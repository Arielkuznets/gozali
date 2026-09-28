-- Photos in a weekly recap collage were kept forever, so storage grew by about 170 MB a year for
-- every active pack (pre-release audit, 2026-09-28). Now they stay 8 weeks after their week, long
-- enough to look back at recent recaps; after that they go like any photo older than 30 days, and
-- the recap keeps its numbers without the collage. Recaps are matched within the photo's own pack,
-- so the check uses the recaps' primary key.
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
        and w.week_start + 7 > (at_time - interval '8 weeks')::date
    )
  order by f.created_at
  limit max_rows;
$$;
