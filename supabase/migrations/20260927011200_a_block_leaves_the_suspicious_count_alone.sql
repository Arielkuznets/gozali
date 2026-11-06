-- The suspicious emoji counts whoever gave it, people the caller blocked too. Its number names
-- nobody, and one that drops when a member is blocked would name them to anyone who blocks the
-- pack's members one at a time and watches it. The other emoji show who reacted, so a blocked
-- member stays out of their names and totals.
create or replace function public.feed_reactions(feed_ids uuid[])
returns table (feed_id uuid, emoji public.reaction_emoji, total bigint, mine boolean, names text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.feed_id,
    r.emoji,
    count(*),
    bool_or(r.user_id = (select auth.uid())),
    case when r.emoji = 'suspicious' then '{}'::text[]
      else array_agg(coalesce(p.display_name, '…') order by r.created_at) end
  from public.reactions r
  join public.feeds f on f.id = r.feed_id
  join public.profiles p on p.id = r.user_id
  where r.feed_id = any (feed_ids)
    and public.is_pack_member(f.pack_id)
    and (r.emoji = 'suspicious' or not public.blocked_by_me(r.user_id))
  group by r.feed_id, r.emoji;
$$;
