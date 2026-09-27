-- The join screen shows the critter as it is now and who is in the pack (spec section 9), not
-- only the species and a member count.

drop function public.pack_preview(text);

create function public.pack_preview(code text)
returns table (
  pack_id uuid,
  pack_name text,
  category public.habit_category,
  custom_habit text,
  critter jsonb,
  member_count integer,
  member_names text[],
  is_full boolean,
  already_member boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.category,
    p.custom_habit,
    jsonb_build_object(
      'species', c.species, 'color', c.color, 'name', c.name, 'health', c.health, 'xp', c.xp,
      'stage', c.stage, 'status', c.status, 'streak', c.streak, 'marks', c.marks, 'outfit', c.outfit
    ),
    coalesce(array_length(members.names, 1), 0),
    members.names,
    coalesce(array_length(members.names, 1), 0) >= public.pack_size_limit(),
    exists (
      select 1 from public.pack_members m
      where m.pack_id = p.id and m.user_id = (select auth.uid()) and m.status <> 'left'
    )
  from public.packs p
  join public.critters c on c.pack_id = p.id
  cross join lateral (
    select coalesce(array_agg(coalesce(pr.display_name, '…') order by m.joined_at), '{}') as names
    from public.pack_members m
    join public.profiles pr on pr.id = m.user_id
    where m.pack_id = p.id and m.status <> 'left'
  ) members
  where p.invite_code = upper(trim(code))
    and (select auth.uid()) is not null;
$$;

revoke execute on function public.pack_preview(text) from public, anon;
grant execute on function public.pack_preview(text) to authenticated;
