-- A posted photo can't change: a member deletes only their own uploads that no feed holds, like one
-- the server turned down. Otherwise a poster could delete a photo's file and upload another image
-- under the same name, and the feed, the pack's screens and the developer's link to a reported photo
-- would show that one. The check runs as its owner, because a photo that reports hid is out of its
-- poster's sight in feeds. The cleanups and account deletion delete files as the service role, which
-- this policy doesn't hold back.
create function public.feed_uses_photo(photo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.feeds f where f.photo_path = photo);
$$;
revoke execute on function public.feed_uses_photo(text) from public, anon;
grant execute on function public.feed_uses_photo(text) to authenticated;

drop policy "feed photos: members delete own" on storage.objects;
create policy "feed photos: members delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feed-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and not public.feed_uses_photo(name)
  );
