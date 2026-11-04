-- Leaving and joining again, or dressing and undressing the critter, is open to any member as
-- often as they like, and every line it writes stays in pack_events for as long as the pack does.
-- A member's join shows once a day: coming back the same day is no news, and a join shows through
-- a block, so it is the one line a blocked member could fill the blocker's feed with. 20 of one
-- member's wardrobe changes a day show, far above the few of someone dressing the critter; the
-- outfit still changes, so the wardrobe never says no.
create or replace function public.record_join_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The creator's own row is the pack's start, not a join.
  if tg_op = 'INSERT' and new.role = 'admin' then
    return new;
  end if;
  if (tg_op = 'INSERT' or (old.status = 'left' and new.status <> 'left'))
    and not exists (
      select 1 from public.pack_events e
      where e.pack_id = new.pack_id and e.kind = 'joined' and e.actor_id = new.user_id
        and e.created_at > now() - interval '1 day'
    ) then
    insert into public.pack_events (pack_id, kind, actor_id) values (new.pack_id, 'joined', new.user_id);
  end if;
  return new;
end;
$$;

create or replace function public.record_critter_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if old.status = 'egg' and new.status <> 'egg' then
    insert into public.pack_events (pack_id, kind) values (new.pack_id, 'hatched');
  elsif new.stage <> old.stage then
    insert into public.pack_events (pack_id, kind, payload)
    values (new.pack_id, 'evolved', jsonb_build_object('from', old.stage, 'to', new.stage));
  end if;
  if old.status = 'active' and new.status = 'ran_away' then
    insert into public.pack_events (pack_id, kind) values (new.pack_id, 'ran_away');
  elsif old.status = 'ran_away' and new.status = 'active' then
    insert into public.pack_events (pack_id, kind) values (new.pack_id, 'returned');
  end if;
  if new.name is distinct from old.name and new.name is not null then
    insert into public.pack_events (pack_id, kind, actor_id, payload)
    values (new.pack_id, 'named', actor, jsonb_build_object('name', new.name));
  end if;
  if new.outfit is distinct from old.outfit and (
    select count(*) from public.pack_events e
    where e.pack_id = new.pack_id and e.kind = 'dressed' and e.actor_id = actor
      and e.created_at > now() - interval '1 day'
  ) < 20 then
    insert into public.pack_events (pack_id, kind, actor_id, payload)
    select new.pack_id, 'dressed', actor, jsonb_build_object('slot', slot, 'item', new.outfit ->> slot)
    from unnest(array['head', 'neck', 'background']) slot
    where new.outfit -> slot is distinct from old.outfit -> slot;
  end if;
  return new;
end;
$$;
