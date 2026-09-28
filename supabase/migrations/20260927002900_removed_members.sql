-- A member the admin removed could join again with the same invite code, since removing and
-- leaving both only set the status to 'left'. Removal is now remembered, and the invite code no
-- longer lets that person back in; someone who left on their own can still return.
alter table public.pack_members add column removed_at timestamptz;

create or replace function public.remove_member(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_admin(target);
begin
  if member = caller then
    raise exception 'use_leave_pack' using errcode = '22023';
  end if;
  update public.pack_members
  set status = 'left', left_at = now(), role = 'member', removed_at = now()
  where pack_id = target and user_id = member and status <> 'left';
end;
$$;

create or replace function public.join_pack(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  target uuid;
  members integer;
begin
  -- Lock the pack row so two people joining at once cannot both take the last spot.
  select id into target from public.packs where invite_code = upper(trim(code)) for update;
  if target is null then
    raise exception 'invite_not_found' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.pack_members where pack_id = target and user_id = caller and status <> 'left') then
    return target;
  end if;
  if exists (select 1 from public.pack_members where pack_id = target and user_id = caller and removed_at is not null) then
    raise exception 'removed_from_pack' using errcode = 'P0001';
  end if;

  select count(*) into members from public.pack_members where pack_id = target and status <> 'left';
  if members >= public.pack_size_limit() then
    raise exception 'pack_full' using errcode = 'P0001';
  end if;
  if public.active_pack_count(caller) >= public.pack_limit() then
    raise exception 'pack_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.pack_members (pack_id, user_id, role)
  values (target, caller, case when members = 0 then 'admin'::public.member_role else 'member'::public.member_role end)
  on conflict (pack_id, user_id) do update
    set status = 'active', role = excluded.role, left_at = null, joined_at = now();
  return target;
end;
$$;
