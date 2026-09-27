-- Photo files no feed points at: an upload whose feed was never saved, for example when the app
-- was removed before a queued feed could go out. Nothing else would ever delete them. A week is
-- long past any retry of the same upload (a retry reuses the file's name and finds it there).
create function public.orphan_photos(at_time timestamptz default now(), max_rows integer default 500)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'feed-photos'
    and o.created_at < at_time - interval '7 days'
    and not exists (select 1 from public.feeds f where f.photo_path = o.name)
  order by o.created_at
  limit max_rows;
$$;
revoke execute on function public.orphan_photos(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.orphan_photos(timestamptz, integer) to service_role;

-- The lookup above, once per file.
create index feeds_by_photo on public.feeds (photo_path) where photo_path is not null;
