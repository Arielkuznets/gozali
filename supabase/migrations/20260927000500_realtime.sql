-- Live updates on the pack screen (spec section 14): the app listens to its packs' critter and
-- members. Realtime checks row level security per subscriber, so the read policies from the
-- row level security migration decide who hears about a change.
alter publication supabase_realtime add table public.critters, public.pack_members;
