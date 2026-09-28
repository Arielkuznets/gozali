-- Members can delete files in their own photo folder: the app removes an upload the server
-- turned down (a blocked word in the caption), so it isn't left behind.
create policy "feed photos: members delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'feed-photos' and (storage.foldername(name))[2] = (select auth.uid())::text);
