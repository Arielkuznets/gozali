-- A photo hidden by reports, or posted by someone the viewer blocked, was gone from the feed, but
-- pack members could still list and download its file from storage (pre-release audit,
-- 2026-09-28). Now a member reads another member's file only through a feed row they can see,
-- so the feeds policy (membership, hidden, blocked) decides; everyone still reads their own
-- uploads, which exist before their feed row does.
drop policy "feed photos: members read" on storage.objects;
create policy "feed photos: members read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feed-photos'
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (select 1 from public.feeds f where f.photo_path = objects.name)
    )
  );
