-- A pack keeps an admin when its admin's membership row goes (2026-10-29). leave_pack passes the
-- role to the longest-standing member, and delete-account leaves every pack before the account
-- goes, but deleting an account from the Auth dashboard (what the report email tells the developer
-- to do with a member who has to go) deletes the rows with no leaving first. A pack whose admin was
-- removed that way had no admin: nobody could change its settings, remove a member, replace a leaked
-- invite code or pick the critter's name. Now the role passes on however the row goes, and packs
-- already without an admin get one.
create function public.pass_on_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' then
    update public.pack_members set role = 'admin'
    where (pack_id, user_id) = (
      select m.pack_id, m.user_id
      from public.pack_members m
      where m.pack_id = old.pack_id and m.status <> 'left'
      order by m.joined_at, m.user_id
      limit 1
    );
  end if;
  return null;
end;
$$;
revoke execute on function public.pass_on_admin() from public, anon, authenticated;

create trigger pass_on_admin after delete on public.pack_members
  for each row execute function public.pass_on_admin();

update public.pack_members m set role = 'admin'
from (
  select distinct on (c.pack_id) c.pack_id, c.user_id
  from public.pack_members c
  where c.status <> 'left'
    and not exists (select 1 from public.pack_members a where a.pack_id = c.pack_id and a.role = 'admin')
  order by c.pack_id, c.joined_at, c.user_id
) heir
where m.pack_id = heir.pack_id and m.user_id = heir.user_id;
