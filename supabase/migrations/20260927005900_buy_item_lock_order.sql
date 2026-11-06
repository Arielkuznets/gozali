-- Everything that changes a pack's critter takes the pack's lock first (2026-10-29), in the day
-- close's order: apply_day_result locks the pack and then updates the critter. buy_item locked the
-- critter and then, inserting the bought item, waited for the pack; dress_critter and choose_name
-- update the critter, whose event trigger then writes to pack_events and so waits for the pack.
-- Any of them exactly as the pack's day closed, or two of them at once, could deadlock.
create or replace function public.buy_item(target uuid, wanted text)
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
  -- The pack first, then the critter, in the day close's order (apply_day_result).
  perform 1 from public.packs p where p.id = target for update;
  perform 1 from public.critters c where c.pack_id = target for update;
  if public.owns_item(target, item_slot, wanted) then
    raise exception 'already_owned' using errcode = 'P0001';
  end if;
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
  -- The pack first, then the critter, in the day close's order (apply_day_result).
  perform 1 from public.packs p where p.id = target for update;
  update public.critters
  set outfit = case when item is null then outfit - slot else outfit || jsonb_build_object(slot, item) end
  where pack_id = target;
end;
$$;

create or replace function public.choose_name(target uuid, suggestion uuid)
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
  -- The pack first, then the critter, in the day close's order (apply_day_result).
  perform 1 from public.packs p where p.id = target for update;
  update public.critters set name = chosen where pack_id = target and name is null;
  if not found then
    raise exception 'name_not_open' using errcode = 'P0001';
  end if;
end;
$$;
