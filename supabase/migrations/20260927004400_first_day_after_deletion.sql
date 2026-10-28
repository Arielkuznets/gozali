-- A pack's first day survives account deletion (2026-10-28). Deleting an account removes its
-- memberships, left ones included, so a pack whose second member deleted their account had no
-- second member any more: pack_first_day returned null, apply_day_result refused the next day as
-- not open, and the day close failed on that pack on every run. Once a pack has closed a day, its
-- first day is the first day it closed.
create or replace function public.pack_first_day(target uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select min(r.day) from public.day_results r where r.pack_id = target),
    (
      select public.pack_day(p.timezone, second.joined_at)
      from public.packs p
      cross join lateral (
        select m.joined_at from public.pack_members m where m.pack_id = p.id order by m.joined_at offset 1 limit 1
      ) second
      where p.id = target
    )
  );
$$;
