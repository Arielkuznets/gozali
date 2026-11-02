-- The day close skips a paused member, whatever they send, and the app shows them as away. An older
-- app can still send a feed during a pause, and so can a phone that kept one through its start. The
-- widget now reads the same way, and the pack hears nothing of a feed that doesn't count.
create or replace function public.widget_state(token text, at_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  update public.widget_tokens set last_used_at = at_time
  where token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
  returning user_id into owner;
  if owner is null then
    return null;
  end if;

  return jsonb_build_object(
    'timezone', (select pr.timezone from public.profiles pr where pr.id = owner),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'dayEndsAt', public.day_closes_at(p.timezone, today.day) - interval '60 minutes',
        'daysRunning', public.pack_first_day(p.id) is not null,
        'critter', jsonb_build_object(
          'name', c.name, 'species', c.species, 'health', c.health, 'stage', c.stage,
          'status', c.status, 'streak', c.streak, 'marks', to_jsonb(c.marks), 'outfit', c.outfit
        ),
        'iFed', public.fed_on(p.id, owner, today.day) and not exists (
          select 1 from public.pauses s where s.pack_id = p.id and s.user_id = owner and today.day between s.starts_on and s.ends_on
        ),
        -- One entry per member, oldest first, without names. In the order of the day close: a pause
        -- comes before a feed.
        'members', (
          select jsonb_agg(
            case
              when exists (
                select 1 from public.pauses s where s.pack_id = p.id and s.user_id = m.user_id and today.day between s.starts_on and s.ends_on
              ) then 'away'
              when public.fed_on(p.id, m.user_id, today.day) then 'fed'
              when m.status = 'sleeping' then 'away'
              when exists (
                select 1 from public.day_passes d where d.pack_id = p.id and d.user_id = m.user_id and d.day = today.day
              ) then 'pass'
              else 'waiting'
            end
            order by m.joined_at)
          from public.pack_members m
          where m.pack_id = p.id and m.status <> 'left'
        )
      ) order by p.created_at)
      from public.pack_members mine
      join public.packs p on p.id = mine.pack_id
      join public.critters c on c.pack_id = p.id
      cross join lateral (select public.pack_day(p.timezone, at_time) as day) today
      where mine.user_id = owner and mine.status <> 'left'
    ), '[]'::jsonb)
  );
end;
$$;

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
  if new.is_extra or exists (
    select 1 from public.pauses s where s.pack_id = new.pack_id and s.user_id = new.user_id and new.day between s.starts_on and s.ends_on
  ) then
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
