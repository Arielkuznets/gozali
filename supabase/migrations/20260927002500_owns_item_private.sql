-- owns_item answers for any pack, so members of one pack could ask about another. Only buy_item
-- and dress_critter need it, and they run as the function owner.
revoke execute on function public.owns_item(uuid, text, text) from authenticated;

-- feed_reaction_counts was replaced by feed_reactions and nothing calls it any more.
drop function public.feed_reaction_counts(uuid);
