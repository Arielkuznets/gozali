-- The caller's packs, by the same rule as is_pack_member. A policy that calls is_pack_member runs it
-- for every row it looks at, which on packs is every pack in the app however few are the caller's.
-- A subquery runs once per read and each pack is only looked up in its answer.
create function public.my_pack_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.pack_id
  from public.pack_members m
  where m.user_id = (select auth.uid())
    and m.status <> 'left';
$$;
revoke execute on function public.my_pack_ids() from public, anon;
grant execute on function public.my_pack_ids() to authenticated;

alter policy "packs: members read" on public.packs using (id in (select public.my_pack_ids()));
