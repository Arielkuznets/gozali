-- One account's uploads have a limit a day, so a crafted loop can't fill the project's file storage
-- for everyone. The app uploads one feed photo a post, at most 6 a pack day in each of 3 packs, so
-- 36 in any 24 hours, and a new profile photo replaces the one before. Only files still there count:
-- a removed upload takes no space. A policy that reads storage.objects itself recurses, so the
-- count runs as its owner.
create function public.uploads_today(bucket text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from storage.objects o
  where o.bucket_id = bucket
    and o.owner_id = (select auth.uid())::text
    and o.created_at > now() - interval '1 day';
$$;
revoke execute on function public.uploads_today(text) from public, anon;
grant execute on function public.uploads_today(text) to authenticated;

drop policy "feed photos: members upload own" on storage.objects;
create policy "feed photos: members upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feed-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_pack_member(((storage.foldername(name))[1])::uuid)
    and public.uploads_today('feed-photos') < 60
  );

drop policy "avatars: members manage own" on storage.objects;
create policy "avatars: members manage own" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.uploads_today('avatars') < 20
  );
