-- A member can always read their own membership rows, including after leaving or being removed.
-- Realtime checks the new row against the read policies, so without this a removed member never
-- heard about the removal and kept looking at the pack until the app refreshed.
create policy "pack_members: read own" on public.pack_members
  for select to authenticated
  using (user_id = (select auth.uid()));
