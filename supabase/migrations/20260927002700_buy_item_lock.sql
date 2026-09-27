-- Two members buying the same item at once: the second one hit the pack_items primary key and
-- got a raw error. Locking the pack's critter first makes the second purchase wait for the
-- first, and then it sees the item is owned.
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
