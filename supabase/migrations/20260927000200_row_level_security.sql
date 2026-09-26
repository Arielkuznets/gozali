-- Row level security: a user sees only the packs they belong to (any status except left).
-- Writes to game state go through server-side functions, so most tables have read policies only.

-- Helpers run as definer so policies on pack_members can use them without recursing.
create function public.is_pack_member(target_pack uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pack_members m
    where m.pack_id = target_pack
      and m.user_id = (select auth.uid())
      and m.status <> 'left'
  );
$$;

-- True when the other user is or was in one of the caller's current packs, so old feed
-- items keep their names after someone leaves.
create function public.shares_pack_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pack_members mine
    join public.pack_members theirs on theirs.pack_id = mine.pack_id
    where mine.user_id = (select auth.uid())
      and mine.status <> 'left'
      and theirs.user_id = other_user
  );
$$;

create function public.blocked_by_me(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b where b.blocker_id = (select auth.uid()) and b.blocked_id = other_user
  );
$$;

-- Reaction counts per emoji. The suspicious emoji is shown only as a number (decision D8),
-- so its rows are hidden by the policy below and counted here instead.
create function public.feed_reaction_counts(target_feed uuid)
returns table (emoji public.reaction_emoji, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.emoji, count(*)
  from public.reactions r
  join public.feeds f on f.id = r.feed_id
  where r.feed_id = target_feed
    and public.is_pack_member(f.pack_id)
  group by r.emoji;
$$;

revoke execute on function public.is_pack_member(uuid) from public, anon;
revoke execute on function public.shares_pack_with(uuid) from public, anon;
revoke execute on function public.blocked_by_me(uuid) from public, anon;
revoke execute on function public.feed_reaction_counts(uuid) from public, anon;
grant execute on function public.is_pack_member(uuid) to authenticated;
grant execute on function public.shares_pack_with(uuid) to authenticated;
grant execute on function public.blocked_by_me(uuid) to authenticated;
grant execute on function public.feed_reaction_counts(uuid) to authenticated;

-- Signed-out clients get nothing at all.
revoke all on all tables in schema public from anon;

alter table public.profiles enable row level security;
alter table public.packs enable row level security;
alter table public.critters enable row level security;
alter table public.pack_members enable row level security;
alter table public.pauses enable row level security;
alter table public.feeds enable row level security;
alter table public.reactions enable row level security;
alter table public.day_passes enable row level security;
alter table public.day_results enable row level security;
alter table public.achievements enable row level security;
alter table public.nudges enable row level security;
alter table public.name_suggestions enable row level security;
alter table public.weekly_recaps enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.widget_tokens enable row level security;

-- Profiles: your own, and people you share a pack with. Only settings columns are writable.
create policy "profiles: read own and pack mates" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_pack_with(id));
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_path, timezone, locale, reminder_time, notification_prefs, terms_accepted_at)
  on public.profiles to authenticated;

-- Pack data: members read, server functions write.
create policy "packs: members read" on public.packs
  for select to authenticated using (public.is_pack_member(id));
create policy "critters: members read" on public.critters
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "pack_members: members read" on public.pack_members
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "pauses: members read" on public.pauses
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "day_passes: members read" on public.day_passes
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "day_results: members read" on public.day_results
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "achievements: members read" on public.achievements
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "name_suggestions: members read" on public.name_suggestions
  for select to authenticated using (public.is_pack_member(pack_id));
create policy "weekly_recaps: members read" on public.weekly_recaps
  for select to authenticated using (public.is_pack_member(pack_id));

-- Feeds: members read, except hidden items and people the reader blocked.
create policy "feeds: members read" on public.feeds
  for select to authenticated
  using (public.is_pack_member(pack_id) and hidden_at is null and not public.blocked_by_me(user_id));

-- Reactions: names are visible for every emoji except the suspicious one, which stays anonymous.
create policy "reactions: members read" on public.reactions
  for select to authenticated
  using (
    exists (select 1 from public.feeds f where f.id = feed_id and public.is_pack_member(f.pack_id))
    and (emoji <> 'suspicious' or user_id = (select auth.uid()))
    and not public.blocked_by_me(user_id)
  );

-- Nudges are private between the two people involved.
create policy "nudges: sender and receiver read" on public.nudges
  for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));

-- Reports: anyone can report an item from their own pack and see their own reports.
create policy "reports: insert own" on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (select 1 from public.feeds f where f.id = feed_id and public.is_pack_member(f.pack_id))
  );
create policy "reports: read own" on public.reports
  for select to authenticated using (reporter_id = (select auth.uid()));

create policy "blocks: manage own" on public.blocks
  for all to authenticated
  using (blocker_id = (select auth.uid()))
  with check (blocker_id = (select auth.uid()));

create policy "notifications: read own" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

create policy "push_tokens: manage own" on public.push_tokens
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- widget_tokens has no policies: only server functions touch it.
