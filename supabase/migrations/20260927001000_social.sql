-- Social (spec section 7): system events in the pack feed, reactions, nudges, naming the
-- critter and dressing it from the wardrobe.

-- System events shown in the feed between the photos. Triggers write them, so every path that
-- changes the critter, unlocks an achievement or takes a joker produces the same events.
create type public.pack_event_kind as enum (
  'joined', 'hatched', 'evolved', 'ran_away', 'returned', 'achievement', 'joker', 'dressed', 'named'
);

create table public.pack_events (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs (id) on delete cascade,
  kind public.pack_event_kind not null,
  -- The member who did it, when a member did it.
  actor_id uuid references public.profiles (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  -- Clock time, not transaction time: a day close that hatches the critter and unlocks an
  -- achievement in one transaction still lists them in order.
  created_at timestamptz not null default clock_timestamp()
);
create index pack_events_recent on public.pack_events (pack_id, created_at desc);

alter table public.pack_events enable row level security;
revoke all on public.pack_events from anon;
revoke insert, update, delete on public.pack_events from authenticated;
create policy "pack_events: members read" on public.pack_events
  for select to authenticated
  using (public.is_pack_member(pack_id) and (actor_id is null or not public.blocked_by_me(actor_id)));

create function public.record_critter_events()
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
  if new.outfit is distinct from old.outfit then
    insert into public.pack_events (pack_id, kind, actor_id, payload)
    select new.pack_id, 'dressed', actor, jsonb_build_object('slot', slot, 'item', new.outfit ->> slot)
    from unnest(array['head', 'neck', 'background']) slot
    where new.outfit -> slot is distinct from old.outfit -> slot;
  end if;
  return new;
end;
$$;
create trigger critter_events after update on public.critters
  for each row execute function public.record_critter_events();

create function public.record_achievement_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pack_events (pack_id, kind, payload) values (new.pack_id, 'achievement', jsonb_build_object('key', new.key));
  return new;
end;
$$;
create trigger achievement_events after insert on public.achievements
  for each row execute function public.record_achievement_event();

-- "Noa is taking a joker today"; taking it back removes the line.
create function public.record_joker_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.kind = 'joker' then
      insert into public.pack_events (pack_id, kind, actor_id, payload)
      values (new.pack_id, 'joker', new.user_id, jsonb_build_object('day', new.day));
    end if;
    return new;
  end if;
  delete from public.pack_events
  where pack_id = old.pack_id and kind = 'joker' and actor_id = old.user_id and payload ->> 'day' = old.day::text;
  return old;
end;
$$;
create trigger joker_events after insert or delete on public.day_passes
  for each row execute function public.record_joker_event();

create function public.record_join_event()
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
  if tg_op = 'INSERT' or (old.status = 'left' and new.status <> 'left') then
    insert into public.pack_events (pack_id, kind, actor_id) values (new.pack_id, 'joined', new.user_id);
  end if;
  return new;
end;
$$;
create trigger join_events after insert or update of status on public.pack_members
  for each row execute function public.record_join_event();

revoke execute on function public.record_critter_events() from public, anon, authenticated;
revoke execute on function public.record_achievement_event() from public, anon, authenticated;
revoke execute on function public.record_joker_event() from public, anon, authenticated;
revoke execute on function public.record_join_event() from public, anon, authenticated;

-- Reactions: one per member per item, changeable; null takes it back. The suspicious emoji
-- has no effect on the critter (spec section 7).
create function public.react(target_feed uuid, emoji public.reaction_emoji)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
begin
  if not exists (
    select 1 from public.feeds f
    where f.id = target_feed and f.hidden_at is null and public.is_pack_member(f.pack_id)
  ) then
    raise exception 'feed_not_found' using errcode = 'P0002';
  end if;
  if emoji is null then
    delete from public.reactions where feed_id = target_feed and user_id = caller;
  else
    insert into public.reactions (feed_id, user_id, emoji) values (target_feed, caller, emoji)
    on conflict (feed_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end;
$$;

-- Reaction totals for a page of feed items, with the caller's own choice and, except for the
-- anonymous suspicious emoji, who reacted. People the caller blocked are left out.
create function public.feed_reactions(feed_ids uuid[])
returns table (feed_id uuid, emoji public.reaction_emoji, total bigint, mine boolean, names text[])
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.feed_id,
    r.emoji,
    count(*),
    bool_or(r.user_id = (select auth.uid())),
    case when r.emoji = 'suspicious' then '{}'::text[]
      else array_agg(coalesce(p.display_name, '…') order by r.created_at) end
  from public.reactions r
  join public.feeds f on f.id = r.feed_id
  join public.profiles p on p.id = r.user_id
  where r.feed_id = any (feed_ids)
    and public.is_pack_member(f.pack_id)
    and not public.blocked_by_me(r.user_id)
  group by r.feed_id, r.emoji;
$$;

-- A nudge: one a day from each member to each member, never to someone paused, resting or on
-- a joker today, who already fed, or who blocked the sender (spec section 7).
create function public.nudge(target uuid, member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
begin
  if member = caller then
    raise exception 'cannot_nudge_self' using errcode = '22023';
  end if;
  perform public.require_membership(target, member);
  if exists (select 1 from public.blocks b where b.blocker_id = member and b.blocked_id = caller) then
    raise exception 'cannot_nudge' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.feeds f where f.pack_id = target and f.user_id = member and f.day = today and not f.is_extra
  ) then
    raise exception 'already_fed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.day_passes d where d.pack_id = target and d.user_id = member and d.day = today)
    or exists (
      select 1 from public.pauses s where s.pack_id = target and s.user_id = member and today between s.starts_on and s.ends_on
    ) then
    raise exception 'not_counted_today' using errcode = 'P0001';
  end if;

  begin
    insert into public.nudges (pack_id, from_user, to_user, day) values (target, caller, member, today);
  exception when unique_violation then
    raise exception 'already_nudged' using errcode = 'P0001';
  end;
  insert into public.notifications (user_id, pack_id, type, payload)
  values (member, target, 'nudge', jsonb_build_object('from', caller));
end;
$$;

-- Naming (spec section 4): after hatching any member suggests, the admin picks.
create function public.suggest_name(target uuid, suggested text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  created uuid;
begin
  perform public.require_membership(target, caller);
  if not exists (select 1 from public.critters c where c.pack_id = target and c.status <> 'egg' and c.name is null) then
    raise exception 'name_not_open' using errcode = 'P0001';
  end if;
  if (select count(*) from public.name_suggestions s where s.pack_id = target and s.user_id = caller) >= 3 then
    raise exception 'too_many_suggestions' using errcode = 'P0001';
  end if;
  insert into public.name_suggestions (pack_id, user_id, name) values (target, caller, trim(suggested))
  returning id into created;
  return created;
end;
$$;

create function public.choose_name(target uuid, suggestion uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen text;
begin
  perform public.require_admin(target);
  select s.name into chosen from public.name_suggestions s where s.id = suggestion and s.pack_id = target;
  if chosen is null then
    raise exception 'suggestion_not_found' using errcode = 'P0002';
  end if;
  update public.critters set name = chosen where pack_id = target and name is null;
  if not found then
    raise exception 'name_not_open' using errcode = 'P0001';
  end if;
end;
$$;

-- The achievement that unlocks each wardrobe item, as in spec section 4 and ACHIEVEMENTS in
-- packages/game-engine. Null for an item that doesn't exist in that slot.
create function public.wardrobe_achievement(item text, slot text)
returns public.achievement_key
language sql
immutable
as $$
  select case slot || ':' || item
    when 'neck:scarf' then 'hatched'
    when 'head:beanie' then 'streak_7'
    when 'head:flower_crown' then 'streak_14'
    when 'neck:cape' then 'streak_30'
    when 'neck:bow_tie' then 'full_house'
    when 'head:sun_hat' then 'early_birds'
    when 'head:headlamp' then 'night_owls'
    when 'background:sunrise' then 'comeback'
    when 'background:park' then 'century'
    when 'background:party' then 'full_pack'
    when 'background:space' then 'grown_up'
    when 'head:halo' then 'legend'
  end::public.achievement_key;
$$;

-- Any member dresses the critter, one unlocked item per slot; null empties the slot.
create function public.dress_critter(target uuid, slot text, item text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
begin
  perform public.require_membership(target, caller);
  if slot not in ('head', 'neck', 'background') then
    raise exception 'bad_slot' using errcode = '22023';
  end if;
  if not exists (select 1 from public.critters c where c.pack_id = target and c.status = 'active') then
    raise exception 'critter_not_here' using errcode = 'P0001';
  end if;
  if item is not null and not exists (
    select 1 from public.achievements a
    where a.pack_id = target and a.key = public.wardrobe_achievement(item, slot)
  ) then
    raise exception 'item_locked' using errcode = 'P0001';
  end if;
  update public.critters
  set outfit = case when item is null then outfit - slot else outfit || jsonb_build_object(slot, item) end
  where pack_id = target;
end;
$$;

-- Personal stats for the Me screen (spec section 9): total feeds, and the current and best
-- streak of days without a miss in any pack. A day where the member counted nowhere (paused,
-- asleep or not started everywhere) neither breaks nor extends the streak.
create function public.my_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as id),
  days as (
    select
      r.day,
      bool_or(me.id = any (r.missed_ids)) as missed,
      bool_or(me.id = any (r.fed_ids)) as fed,
      bool_or(me.id = any (r.rested_ids) or me.id = any (r.joker_ids)) as rested
    from public.day_results r
    join public.pack_members m on m.pack_id = r.pack_id
    cross join me
    where m.user_id = me.id
    group by r.day
  ),
  graded as (
    select day, missed, fed, rested,
      sum(missed::int) over (order by day) as run
    from days
    where missed or fed or rested
  ),
  runs as (
    select run, count(*) filter (where not missed) as length from graded group by run
  )
  select jsonb_build_object(
    'totalFeeds', (
      select count(*) from public.feeds f, me where f.user_id = me.id and not f.is_extra
    ),
    'currentStreak', coalesce((select length from runs order by run desc limit 1), 0),
    'bestStreak', coalesce((select max(length) from runs), 0),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', day,
        'status', case when missed then 'missed' when fed then 'fed' else 'rest' end
      ) order by day)
      from graded
      where day > current_date - 62
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.react(uuid, public.reaction_emoji) from public, anon;
revoke execute on function public.feed_reactions(uuid[]) from public, anon;
revoke execute on function public.nudge(uuid, uuid) from public, anon;
revoke execute on function public.suggest_name(uuid, text) from public, anon;
revoke execute on function public.choose_name(uuid, uuid) from public, anon;
revoke execute on function public.dress_critter(uuid, text, text) from public, anon;
revoke execute on function public.my_stats() from public, anon;
grant execute on function public.react(uuid, public.reaction_emoji) to authenticated;
grant execute on function public.feed_reactions(uuid[]) to authenticated;
grant execute on function public.nudge(uuid, uuid) to authenticated;
grant execute on function public.suggest_name(uuid, text) to authenticated;
grant execute on function public.choose_name(uuid, uuid) to authenticated;
grant execute on function public.dress_critter(uuid, text, text) to authenticated;
grant execute on function public.my_stats() to authenticated;

alter publication supabase_realtime add table public.pack_events, public.reactions, public.name_suggestions;
