-- Profile photos (spec section 9: optional in profile setup). Private like feed photos: a member
-- manages the files in their own folder (<user id>/...), and people who share a pack with them
-- can see them through signed links. They never appear in widgets or shared stories.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/jpeg']);

create policy "avatars: members manage own" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars: pack mates read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and public.shares_pack_with(((storage.foldername(name))[1])::uuid));

-- The avatar path must point into the member's own folder, so no one borrows another's photo.
alter table public.profiles
  add constraint avatar_in_own_folder check (avatar_path is null or avatar_path like id::text || '/%');
