-- The admin role goes to someone who plays: a member awake before one asleep, then one with a
-- counted feed since joining before one without, and among those the longest-standing. Nothing in
-- the app hands the role on once it is given, so a sleeper or someone who joined and never fed
-- would hold the pack's name, rules, code and the pet's name for good. A pack of only sleepers
-- still gets an admin. A feed counts from the day of joining, as it does for starting to play.
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
      select m.user_id into successor
      from public.pack_members m
      where m.pack_id = target and m.status <> 'left'
      order by (m.status = 'active') desc,
        exists (
          select 1 from public.feeds f
          where f.pack_id = target and f.user_id = m.user_id and not f.is_extra
            and f.day >= public.pack_day(zone, m.joined_at)
        ) desc,
        m.joined_at, m.user_id
      limit 1;
      exit when successor is null;
      update public.pack_members set role = 'admin' where pack_id = target and user_id = successor;
      exit when found;
    end loop;
  end if;
end;
$$;

create or replace function public.pass_on_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone text;
  heir uuid;
begin
  if old.role = 'admin' then
    select timezone into zone from public.packs where id = old.pack_id for update;
    loop
      select m.user_id into heir
      from public.pack_members m
      where m.pack_id = old.pack_id and m.status <> 'left'
      order by (m.status = 'active') desc,
        exists (
          select 1 from public.feeds f
          where f.pack_id = old.pack_id and f.user_id = m.user_id and not f.is_extra
            and f.day >= public.pack_day(zone, m.joined_at)
        ) desc,
        m.joined_at, m.user_id
      limit 1;
      exit when heir is null;
      update public.pack_members set role = 'admin' where pack_id = old.pack_id and user_id = heir;
      exit when found;
    end loop;
  end if;
  return null;
end;
$$;
