-- The admin removes from a list that can be a moment old, so the member can have left just before.
-- They are kept out all the same, and their row still says when they left.
create or replace function public.remove_member(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  zone text;
begin
  -- Before the check: an admin leaving on another phone has handed the role on by then.
  select timezone into zone from public.packs where id = target for update;
  caller := public.require_admin(target);
  if member = caller then
    raise exception 'use_leave_pack' using errcode = '22023';
  end if;
  update public.pack_members
  set status = 'left', left_at = now(), role = 'member', removed_at = now(),
    awake_since = case when status = 'sleeping' then public.pack_day(zone) else awake_since end
  where pack_id = target and user_id = member and status <> 'left';
  update public.pack_members set removed_at = now()
  where pack_id = target and user_id = member and status = 'left' and removed_at is null;
end;
$$;
