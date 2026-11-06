-- Packs with nobody in them since 30 days before at_time. A pack whose last member deleted their
-- account has no row left that says when they went, and the time a member left before them would
-- take days off the 30 that member has to come back. Days close only while someone is in a pack,
-- so the later of the last time someone left and the last close is when it was last seen with
-- someone in it. A pack with neither falls back to its creation time. A thousand at a time, the
-- first by id, so the photos a run removes and the packs it drops are the same ones, and a backlog
-- shrinks run by run instead of outgrowing the time limit.
create or replace function public.empty_packs(at_time timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.packs p
  where not exists (select 1 from public.pack_members m where m.pack_id = p.id and m.status <> 'left')
    and coalesce(
      greatest(
        (select max(m.left_at) from public.pack_members m where m.pack_id = p.id),
        (select max(r.closed_at) from public.day_results r where r.pack_id = p.id)
      ),
      p.created_at
    ) < at_time - interval '30 days'
  order by p.id
  limit 1000;
$$;
