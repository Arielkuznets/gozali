-- A purchase from the outfit shop shows in the pack feed (decision D21). Its own migration:
-- a new enum value can't be used in the transaction that adds it.
alter type public.pack_event_kind add value 'bought';
