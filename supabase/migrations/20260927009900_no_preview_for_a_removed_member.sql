-- A member the admin removed can't come back through the invite code, and it doesn't show them who
-- is in the pack now either. Someone who left on their own still sees it.
create or replace function public.pack_preview(code text)
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    return;
  end if;
  perform public.check_code_attempts(caller);
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'read_only' using errcode = '25006';
  end if;
  if exists (
    select 1
    from public.pack_members m
    join public.packs p on p.id = m.pack_id
    where p.invite_code = upper(trim(code)) and m.user_id = caller and m.status = 'left' and m.removed_at is not null
  ) then
    raise exception 'removed_from_pack' using errcode = 'P0001';
  end if;
  return query
  select
      p.id,
      p.name,
      p.category,
      p.custom_habit,
      jsonb_build_object(
        'species', c.species, 'name', c.name, 'health', c.health, 'xp', c.xp,
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
    where p.invite_code = upper(trim(code));
  if not found then
    insert into public.code_misses (user_id) values (caller);
  end if;
end;
$$;
