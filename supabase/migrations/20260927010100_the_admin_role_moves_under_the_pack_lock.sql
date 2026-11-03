-- The admin role changes hands with the pack row locked, as in leave_pack and join_pack. Without the
-- lock, a leave, a removal or a join at the same moment acts on a list of members that is about to
-- change: the role can go to someone on their way out, or nowhere, and a pack with no admin has
-- nobody who can rename it, remove a member or replace its code.
--
-- An admin's account deleted from the dashboard already holds its own rows when it reaches the lock,
-- the other way round from the day close and a feed. If one of those touches the same rows at that
-- moment the two deadlock, and Postgres stops one: nothing of it stays, the next run of the close
-- starts that day again, the phone's queue sends the feed again, and the deletion can be repeated.
-- Deleting an account in the app leaves every pack first, so it never gets here as an admin.
create or replace function public.pass_on_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' then
    perform 1 from public.packs where id = old.pack_id for update;
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

create or replace function public.remove_member(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
begin
  -- Before the check: an admin leaving on another phone has handed the role on by then.
  perform 1 from public.packs where id = target for update;
  caller := public.require_admin(target);
  if member = caller then
    raise exception 'use_leave_pack' using errcode = '22023';
  end if;
  update public.pack_members
  set status = 'left', left_at = now(), role = 'member', removed_at = now()
  where pack_id = target and user_id = member and status <> 'left';
end;
$$;

-- Nothing else brings a pack's admin back: someone who left gives the role up, and a pack with
-- members and no admin gets its longest-standing member, as a succession would.
update public.pack_members set role = 'member' where role = 'admin' and status = 'left';

update public.pack_members m set role = 'admin'
from (
  select distinct on (c.pack_id) c.pack_id, c.user_id
  from public.pack_members c
  where c.status <> 'left'
    and not exists (select 1 from public.pack_members a where a.pack_id = c.pack_id and a.role = 'admin')
  order by c.pack_id, c.joined_at, c.user_id
) heir
where m.pack_id = heir.pack_id and m.user_id = heir.user_id;
