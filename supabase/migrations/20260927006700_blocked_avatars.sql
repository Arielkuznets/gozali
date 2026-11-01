-- Someone you blocked is out of sight in their profile photo too, like their feed photos: the file
-- can't be listed or signed by the person who blocked them. A block works one way, so the blocked
-- member still sees the other's photo, and the owner's own policy keeps their files theirs.
drop policy "avatars: pack mates read" on storage.objects;
create policy "avatars: pack mates read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and public.shares_pack_with(((storage.foldername(name))[1])::uuid)
    and not public.blocked_by_me(((storage.foldername(name))[1])::uuid)
  );
