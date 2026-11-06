-- What one account keeps in storage has a limit too, however long ago it went up: unposted photos
-- stay 7 days, posted ones 30, and those in a recap collage 8 weeks after its week, so a limit a day
-- doesn't bound it. A member who posts the most the app allows, 6 photos a pack day in 3 packs,
-- keeps about 540 photos from the last 30 days and up to 135 older ones in collages, about 220 MB at
-- the 330 KB a busy 1080px photo takes; one feed a day in 3 packs keeps about 30 MB from the last 30
-- days. The app keeps one profile photo, 256px wide, of tens of KB. Storage writes a file's size into
-- its metadata once the file is in, so a file still on its way doesn't count yet.
create function public.bytes_held(bucket text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::numeric), 0)::bigint
  from storage.objects o
  where o.bucket_id = bucket
    and o.owner_id = (select auth.uid())::text;
$$;
revoke execute on function public.bytes_held(text) from public, anon;
grant execute on function public.bytes_held(text) to authenticated;

drop policy "feed photos: members upload own" on storage.objects;
create policy "feed photos: members upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feed-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_pack_member(((storage.foldername(name))[1])::uuid)
    and public.uploads_today('feed-photos') < 60
    and public.bytes_held('feed-photos') < 300000000
  );

drop policy "avatars: members manage own" on storage.objects;
create policy "avatars: members manage own" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.uploads_today('avatars') < 20
    and public.bytes_held('avatars') < 5000000
  );
