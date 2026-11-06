-- Leaving ends a sleep the way a feed does, so awake_since takes the day it ended. Once the status
-- only says 'left', that is what tells a close still to come that the member was asleep on the days
-- before it. It is a day like any other, so a rejoin has nothing to clear: the misses count from it.
create or replace function public.leave_pack(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  zone text;
  was_admin boolean;
  successor uuid;
begin
  select timezone into zone from public.packs where id = target for update;

  select role = 'admin' into was_admin
  from public.pack_members
  where pack_id = target and user_id = caller and status <> 'left';
  if was_admin is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  update public.pack_members
  set status = 'left', left_at = now(), role = 'member',
    awake_since = case when status = 'sleeping' then public.pack_day(zone) else awake_since end
  where pack_id = target and user_id = caller;

  if was_admin then
    loop
      select user_id into successor
      from public.pack_members
      where pack_id = target and status <> 'left'
      order by joined_at, user_id
      limit 1;
      exit when successor is null;
      update public.pack_members set role = 'admin' where pack_id = target and user_id = successor;
      exit when found;
    end loop;
  end if;
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
end;
$$;
