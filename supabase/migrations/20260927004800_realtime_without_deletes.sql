-- Realtime no longer sends deletes (2026-10-29). Row level security decides who hears about a new
-- or changed row, but a deleted row is gone and can't be checked, so Realtime sent every delete on
-- the published tables to everyone listening, in any pack: the key of a reaction taken back (whose
-- 🤨 it was, which the spec keeps anonymous), of a joker or rest taken back (the pack, the member and
-- the day), of a member whose account went. And every open app refetched on each of them, from every
-- pack. Without deletes, a friend taking something back shows on the next refresh instead of at once.
alter publication supabase_realtime set (publish = 'insert, update');
