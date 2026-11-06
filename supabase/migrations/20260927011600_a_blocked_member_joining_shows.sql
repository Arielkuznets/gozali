-- Someone you blocked still shows when they join a pack you are in, live through Realtime too: a
-- join isn't content, and a block doesn't keep them out of your packs or from reading what you post
-- there, so you are the one member who most needs that line. Their other feed lines stay hidden.
alter policy "pack_events: members read" on public.pack_events
  using (public.is_pack_member(pack_id) and (actor_id is null or kind = 'joined' or not public.blocked_by_me(actor_id)));
