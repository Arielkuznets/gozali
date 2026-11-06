-- Who fed lately in the caller's packs, for the circles and counts on every screen. The day close
-- counts a feed whatever became of its photo, while the feeds policy keeps a hidden feed from
-- everyone and a blocked member's from whoever blocked them. That policy guards the photo and the
-- caption, so what comes out here is only who and which day.
create function public.counted_feeds()
returns table (pack_id uuid, user_id uuid, day date)
language sql
stable
security definer
set search_path = ''
as $$
  select f.pack_id, f.user_id, f.day
  from public.pack_members mine
  join public.feeds f on f.pack_id = mine.pack_id
  where mine.user_id = (select auth.uid())
    and mine.status <> 'left'
    and not f.is_extra
    -- A pack's day is at most a day from UTC's, so this reaches today in every time zone.
    and f.day >= (now() at time zone 'utc')::date - 2;
$$;
revoke execute on function public.counted_feeds() from public, anon;
grant execute on function public.counted_feeds() to authenticated;
