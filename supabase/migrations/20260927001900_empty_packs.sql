-- Packs everyone left (spec section 3): someone joining with an old link becomes the admin, and a
-- pack that stays empty for 30 days is deleted with its photo files by the close-days function.

-- Joining a pack with nobody in it makes you its admin, or the pack would have none.
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

-- Packs with nobody in them since 30 days before at_time. A pack whose last member deleted their
-- account has no member rows left, so its creation time stands in.
create function public.empty_packs(at_time timestamptz)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.packs p
  where not exists (select 1 from public.pack_members m where m.pack_id = p.id and m.status <> 'left')
    and coalesce((select max(m.left_at) from public.pack_members m where m.pack_id = p.id), p.created_at)
      < at_time - interval '30 days';
$$;

-- The photo files of those packs, removed before the packs so no file is left behind.
create function public.empty_pack_photos(at_time timestamptz)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select f.photo_path
  from public.feeds f
  where f.pack_id in (select public.empty_packs(at_time)) and f.photo_path is not null;
$$;

drop function public.drop_empty_packs();

create function public.drop_empty_packs(at_time timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dropped integer;
begin
  delete from public.packs where id in (select public.empty_packs(at_time));
  get diagnostics dropped = row_count;
  return dropped;
end;
$$;

revoke execute on function public.empty_packs(timestamptz) from public, anon, authenticated;
revoke execute on function public.empty_pack_photos(timestamptz) from public, anon, authenticated;
revoke execute on function public.drop_empty_packs(timestamptz) from public, anon, authenticated;
grant execute on function public.empty_packs(timestamptz) to service_role;
grant execute on function public.empty_pack_photos(timestamptz) to service_role;
grant execute on function public.drop_empty_packs(timestamptz) to service_role;
