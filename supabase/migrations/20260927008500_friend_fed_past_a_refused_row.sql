-- A "friend fed" row Expo refused is out of the ten-minute wait the merging is for: it can sit for
-- two hours and may end up dropped, and whatever it took in would go with it. Merging now stops at a
-- row's first refusal, so a later feed starts a row of its own. A row an outage sent back spent no
-- try, comes back within a minute and still merges.
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
    where user_id = member and pack_id = new.pack_id and type = 'friend_fed' and status = 'pending' and attempts = 0;
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
