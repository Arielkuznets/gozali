-- A name suggestion is member text with its author's name under it, so like their feeds, reactions
-- and feed events it is out of sight for whoever blocked its author, live through Realtime too.
-- A block works one way: the rest of the pack, and the blocked member, still read it.
alter policy "name_suggestions: members read" on public.name_suggestions
  using (public.is_pack_member(pack_id) and not public.blocked_by_me(user_id));
