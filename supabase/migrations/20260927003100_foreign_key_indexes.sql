-- Indexes for foreign keys no index covered yet. Deleting an account or a pack cascades through
-- these columns, and without an index each cascade reads the whole table. The member-side
-- lookups (a member's tokens, a pack's notifications) use them too.
create index reactions_by_user on public.reactions (user_id);
create index nudges_to_member on public.nudges (pack_id, to_user);
create index name_suggestions_by_member on public.name_suggestions (pack_id, user_id);
create index reports_by_reporter on public.reports (reporter_id);
create index blocks_by_blocked on public.blocks (blocked_id);
create index notifications_by_pack on public.notifications (pack_id);
create index push_tokens_by_user on public.push_tokens (user_id);
create index widget_tokens_by_user on public.widget_tokens (user_id);
create index pack_events_by_actor on public.pack_events (actor_id);
create index pack_items_by_buyer on public.pack_items (bought_by);
