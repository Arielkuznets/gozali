-- "Friend fed" names each feeder once (2026-10-29). A member who fed just before and just after
-- 03:00 has two counted feeds within the ten minutes a notification waits, and was added to it twice:
-- "2 friends fed Pixel" for one friend.
create or replace function public.notify_feed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid;
  remaining uuid[];
begin
  if new.is_extra then
    return new;
  end if;

  for member in
    select m.user_id from public.pack_members m
    where m.pack_id = new.pack_id and m.status <> 'left' and m.user_id <> new.user_id
      and not exists (select 1 from public.blocks b where b.blocker_id = m.user_id and b.blocked_id = new.user_id)
  loop
    -- A member is named once, even with two counted feeds in one wait (one each side of 03:00).
    update public.notifications
    set payload = case
      when payload -> 'feeders' @> jsonb_build_array(new.user_id) then payload
      else jsonb_set(payload, '{feeders}', (payload -> 'feeders') || to_jsonb(new.user_id))
    end
    where user_id = member and pack_id = new.pack_id and type = 'friend_fed' and status = 'pending';
    if not found then
      insert into public.notifications (user_id, pack_id, type, payload, send_after)
      values (member, new.pack_id, 'friend_fed', jsonb_build_object('feeders', jsonb_build_array(new.user_id)), now() + interval '10 minutes');
    end if;
  end loop;

  -- Counted members who started feeding at some point and haven't fed today.
  select array_agg(m.user_id) into remaining
  from public.pack_members m
  where m.pack_id = new.pack_id
    and public.counted_on(new.pack_id, m.user_id, new.day)
    and not public.fed_on(new.pack_id, m.user_id, new.day)
    and exists (
      select 1 from public.feeds f
      where f.pack_id = new.pack_id and f.user_id = m.user_id and not f.is_extra
        and f.day >= public.pack_day((select p.timezone from public.packs p where p.id = new.pack_id), m.joined_at)
    );
  if cardinality(remaining) = 1 then
    insert into public.notifications (user_id, pack_id, type, day)
    values (remaining[1], new.pack_id, 'last_one', new.day)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
