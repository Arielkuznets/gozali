-- The pilot's numbers (spec sections 1 and 15), straight from the data, for the developer:
--   npx supabase db query --linked "select public.pilot_metrics()"
-- An active pack has at least 2 members, and at least half of its members, with 3 or more
-- counted feeds in the last 7 days. A pack's creator is its first member; a member who deleted
-- their account leaves no row behind, so their packs count the next member as the creator.
create function public.pilot_metrics(at_time timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select m.pack_id, m.user_id from public.pack_members m where m.status <> 'left'
  ),
  steady as (
    select f.pack_id, f.user_id
    from public.feeds f
    where not f.is_extra and f.created_at > at_time - interval '7 days' and f.created_at <= at_time
    group by f.pack_id, f.user_id
    having count(*) >= 3
  ),
  packs as (
    select
      p.id,
      p.created_at,
      (select count(*) from members m where m.pack_id = p.id) as size,
      (select count(*) from steady s join members m using (pack_id, user_id) where s.pack_id = p.id) as steady
    from public.packs p
    where p.created_at <= at_time
  ),
  graded as (
    select *, steady >= 2 and steady * 2 >= size as active from packs
  ),
  creators as (
    select distinct on (m.pack_id) m.pack_id, m.user_id
    from public.pack_members m
    order by m.pack_id, m.joined_at, m.user_id
  ),
  invited as (
    select m.user_id, min(m.joined_at) as joined_at
    from public.pack_members m
    where not exists (select 1 from creators c where c.pack_id = m.pack_id and c.user_id = m.user_id)
    group by m.user_id
  )
  select jsonb_build_object(
    'packs', (select count(*) from graded),
    'activeNow', (select count(*) from graded where active),
    'packs14DaysOld', (select count(*) from graded where created_at <= at_time - interval '14 days'),
    'activeAfter14Days', (select count(*) from graded where created_at <= at_time - interval '14 days' and active),
    'averageSize', (select coalesce(round(avg(size), 1), 0) from graded where size > 0),
    'invitedUsers', (select count(*) from invited),
    'invitedWhoOpenedAPack', (
      select count(*) from invited i
      where exists (
        select 1 from creators c join public.packs p on p.id = c.pack_id
        where c.user_id = i.user_id and p.created_at between i.joined_at and i.joined_at + interval '30 days'
      )
    )
  );
$$;

revoke execute on function public.pilot_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.pilot_metrics(timestamptz) to service_role;
