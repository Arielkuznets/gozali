-- Coins and the outfit shop (decision D21). A successful day earns the pack coins, more with a
-- longer streak (the game engine decides how many); any member spends them on outfits. Items an
-- achievement unlocks stay free rewards, and three of them can't be bought at all.

alter table public.critters add column coins integer not null default 0 check (coins >= 0);
alter table public.day_results add column coins smallint not null default 0;

-- The shop: what can be bought, for which slot, at what price.
create table public.shop_items (
  item text primary key,
  slot text not null check (slot in ('head', 'neck', 'background')),
  price integer not null check (price > 0),
  sort smallint not null
);

alter table public.shop_items enable row level security;
revoke all on public.shop_items from anon;
revoke insert, update, delete on public.shop_items from authenticated;
create policy "shop_items: signed-in users read" on public.shop_items
  for select to authenticated using (true);

insert into public.shop_items (item, slot, price, sort) values
  ('bow', 'head', 10, 1),
  ('bandana', 'neck', 10, 2),
  ('scarf', 'neck', 10, 3),
  ('cap', 'head', 12, 4),
  ('beanie', 'head', 12, 5),
  ('bow_tie', 'neck', 15, 6),
  ('bell', 'neck', 15, 7),
  ('sun_hat', 'head', 18, 8),
  ('flower_crown', 'head', 20, 9),
  ('pearls', 'neck', 20, 10),
  ('headlamp', 'head', 20, 11),
  ('park', 'background', 25, 12),
  ('sunrise', 'background', 25, 13),
  ('beach', 'background', 25, 14),
  ('snow', 'background', 25, 15),
  ('wizard_hat', 'head', 30, 16),
  ('party', 'background', 30, 17),
  ('stars', 'background', 35, 18),
  ('crown', 'head', 45, 19);

-- What each pack bought.
create table public.pack_items (
  pack_id uuid not null references public.packs (id) on delete cascade,
  item text not null references public.shop_items (item),
  bought_by uuid references public.profiles (id) on delete set null,
  bought_at timestamptz not null default now(),
  primary key (pack_id, item)
);

alter table public.pack_items enable row level security;
revoke all on public.pack_items from anon;
revoke insert, update, delete on public.pack_items from authenticated;
create policy "pack_items: members read" on public.pack_items
  for select to authenticated using (public.is_pack_member(pack_id));

alter publication supabase_realtime add table public.pack_items;

-- A pack owns an item it bought, or one an achievement of its unlocked.
create function public.owns_item(target uuid, wanted_slot text, wanted_item text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pack_items p
    join public.shop_items s on s.item = p.item
    where p.pack_id = target and p.item = wanted_item and s.slot = wanted_slot
  ) or exists (
    select 1 from public.achievements a
    where a.pack_id = target and a.key = public.wardrobe_achievement(wanted_item, wanted_slot)
  );
$$;

-- Buying for the pack: any member, with the pack's coins. Returns the coins left.
create function public.buy_item(target uuid, wanted text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  cost integer;
  item_slot text;
  left_coins integer;
begin
  perform public.require_membership(target, caller);
  select s.price, s.slot into cost, item_slot from public.shop_items s where s.item = wanted;
  if cost is null then
    raise exception 'not_for_sale' using errcode = 'P0001';
  end if;
  if public.owns_item(target, item_slot, wanted) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
  -- The check and the payment are one statement, so two members buying at once can't overspend.
  update public.critters set coins = coins - cost
  where pack_id = target and coins >= cost
  returning coins into left_coins;
  if left_coins is null then
    raise exception 'not_enough_coins' using errcode = 'P0001';
  end if;
  insert into public.pack_items (pack_id, item, bought_by) values (target, wanted, caller);
  insert into public.pack_events (pack_id, kind, actor_id, payload)
  values (target, 'bought', caller, jsonb_build_object('item', wanted, 'slot', item_slot, 'price', cost));
  return left_coins;
end;
$$;

-- Dressing now takes anything the pack owns, bought or unlocked.
create or replace function public.dress_critter(target uuid, slot text, item text)
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
  if item is not null and not public.owns_item(target, slot, item) then
    raise exception 'item_locked' using errcode = 'P0001';
  end if;
  update public.critters
  set outfit = case when item is null then outfit - slot else outfit || jsonb_build_object(slot, item) end
  where pack_id = target;
end;
$$;

revoke execute on function public.owns_item(uuid, text, text) from public, anon;
revoke execute on function public.buy_item(uuid, text) from public, anon;
grant execute on function public.owns_item(uuid, text, text) to authenticated;
grant execute on function public.buy_item(uuid, text) to authenticated;

-- The day close records the day's coins and adds them to the pack's wallet. Otherwise the
-- same as before (20260927001700_review_fixes).
create or replace function public.apply_day_result(target uuid, pack_date date, outcome jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_day date;
  critter_after jsonb := outcome -> 'critter';
  outcomes jsonb := outcome -> 'outcomes';
  earned integer := coalesce((outcome ->> 'coins')::integer, 0);
  event jsonb;
  achievement text;
  slept uuid[];
begin
  -- One close per pack at a time.
  perform 1 from public.packs where id = target for update;
  if not found then
    raise exception 'pack_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.day_results r where r.pack_id = target and r.day = pack_date) then
    return false;
  end if;
  first_day := public.pack_first_day(target);
  if first_day is null or pack_date < first_day then
    raise exception 'day_not_open' using errcode = 'P0001';
  end if;
  if pack_date > first_day
    and not exists (select 1 from public.day_results r where r.pack_id = target and r.day = pack_date - 1) then
    raise exception 'previous_day_open' using errcode = 'P0001';
  end if;

  insert into public.day_results (
    pack_id, day, result, applied, fed_ids, rested_ids, joker_ids, paused_ids, sleeping_ids, missed_ids,
    health_before, health_after, early_bird, full_house, night_owl_feeds, coins
  ) values (
    target, pack_date, (outcome ->> 'type')::public.day_type, (outcome ->> 'applied')::boolean,
    public.outcome_ids(outcomes, 'fed'), public.outcome_ids(outcomes, 'rest'), public.outcome_ids(outcomes, 'joker'),
    public.outcome_ids(outcomes, 'paused'), public.outcome_ids(outcomes, 'sleeping'), public.outcome_ids(outcomes, 'missed'),
    (outcome ->> 'healthBefore')::smallint, (critter_after ->> 'health')::smallint,
    (outcome -> 'facts' ->> 'earlyBird')::boolean, (outcome -> 'facts' ->> 'fullHouse')::boolean,
    (outcome -> 'facts' ->> 'nightOwlFeeds')::smallint, earned
  );

  if (outcome ->> 'applied')::boolean then
    update public.critters set
      status = (critter_after ->> 'status')::public.critter_status,
      health = (critter_after ->> 'health')::smallint,
      xp = (critter_after ->> 'xp')::integer,
      stage = (critter_after ->> 'stage')::public.critter_stage,
      streak = (critter_after ->> 'streak')::integer,
      marks = array(select jsonb_array_elements_text(critter_after -> 'marks')),
      coins = coins + earned,
      hatched_at = coalesce(hatched_at, case when critter_after ->> 'status' <> 'egg' then now() end)
    where pack_id = target;
  end if;

  -- Members fall asleep, unless they already fed on a later day (a close that ran late).
  with asleep as (
    update public.pack_members m set status = 'sleeping'
    where m.pack_id = target
      and m.status = 'active'
      and m.user_id in (select value::uuid from jsonb_array_elements_text(outcome -> 'newlySleeping'))
      and not exists (
        select 1 from public.feeds f
        where f.pack_id = target and f.user_id = m.user_id and f.day > pack_date and not f.is_extra
      )
    returning m.user_id
  )
  select coalesce(array_agg(user_id), '{}') into slept from asleep;

  for achievement in select value from jsonb_array_elements_text(coalesce(outcome -> 'achievements', '[]'::jsonb)) loop
    insert into public.achievements (pack_id, key) values (target, achievement::public.achievement_key)
    on conflict do nothing;
    insert into public.notifications (user_id, pack_id, type, payload)
    select m.user_id, target, 'evolution', jsonb_build_object('event', 'achievement', 'key', achievement)
    from public.pack_members m where m.pack_id = target and m.status <> 'left';
  end loop;

  -- Notifications go to the outbox in this same transaction (spec section 14).
  for event in select value from jsonb_array_elements(outcome -> 'events') loop
    if event ->> 'type' = 'member_slept' then
      if (event ->> 'userId')::uuid = any (slept) then
        insert into public.notifications (user_id, pack_id, type, payload)
        values ((event ->> 'userId')::uuid, target, 'still_in', jsonb_build_object('event', 'member_slept'));
      end if;
    elsif event ->> 'type' in ('hatched', 'evolved')
      or event ->> 'type' in ('ran_away', 'returned')
      or (event ->> 'type' = 'health_state_changed' and event ->> 'to' in ('weak', 'sick')) then
      insert into public.notifications (user_id, pack_id, type, payload)
      select m.user_id, target,
        case when event ->> 'type' in ('hatched', 'evolved') then 'evolution' else 'pet_state' end::public.notification_type,
        jsonb_build_object('event', event ->> 'type') || (event - 'type')
      from public.pack_members m where m.pack_id = target and m.status <> 'left';
    end if;
  end loop;

  -- Rest days and week start chosen for the next week take over once their first day is next.
  update public.packs set
    rest_days_per_week = pending_rest_days_per_week,
    week_start = pending_week_start,
    pending_rest_days_per_week = null,
    pending_week_start = null,
    pending_from = null
  where id = target and pending_from <= pack_date + 1;

  return true;
end;
$$;
