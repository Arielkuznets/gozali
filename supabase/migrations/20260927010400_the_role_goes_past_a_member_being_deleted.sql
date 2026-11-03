-- Deleting a member's account takes no pack lock unless they are the admin, so the member picked to
-- take the role can be on their way out. The update then waits for that deletion and finds nobody,
-- which would leave the pack with no admin, so the next member is picked. Their row is gone from
-- that next read, so this ends.
create or replace function public.pass_on_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  heir uuid;
begin
  if old.role = 'admin' then
    perform 1 from public.packs where id = old.pack_id for update;
    loop
      select m.user_id into heir
      from public.pack_members m
      where m.pack_id = old.pack_id and m.status <> 'left'
      order by m.joined_at, m.user_id
      limit 1;
      exit when heir is null;
      update public.pack_members set role = 'admin' where pack_id = old.pack_id and user_id = heir;
      exit when found;
    end loop;
  end if;
  return null;
end;
$$;

create or replace function public.leave_pack(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  was_admin boolean;
  successor uuid;
begin
  perform 1 from public.packs where id = target for update;

  select role = 'admin' into was_admin
  from public.pack_members
  where pack_id = target and user_id = caller and status <> 'left';
  if was_admin is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  update public.pack_members
  set status = 'left', left_at = now(), role = 'member'
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
