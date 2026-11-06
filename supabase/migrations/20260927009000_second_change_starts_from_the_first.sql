-- A change of rest days or week start is in force from its date, though only a close makes it the
-- pack's own, and a pack of one has no close to do that. The next change starts from what is in
-- force, not from the setting before it.
create or replace function public.update_pack(target uuid, pack_name text, rest_days smallint, starts_on week_start)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pack public.packs;
  today date;
begin
  perform public.require_admin(target);
  if rest_days is null or starts_on is null then
    raise exception 'bad_settings' using errcode = '22023';
  end if;
  select * into pack from public.packs where id = target for update;
  today := public.pack_day(pack.timezone);

  -- Up to the next day to close, which reads the change anyway: no open day changes rules.
  perform public.fold_pending_settings(target, coalesce(
    (select max(r.day) + 1 from public.day_results r where r.pack_id = target),
    public.pack_first_day(target),
    today
  ));
  select * into pack from public.packs where id = target;

  update public.packs set name = trim(pack_name) where id = target;

  -- A change that started today stays as it is: the day close makes it the pack's own once the
  -- day before has closed by the old settings.
  if pack.pending_from <= today
    and rest_days = pack.pending_rest_days_per_week and starts_on = pack.pending_week_start then
    return;
  end if;

  if rest_days = pack.rest_days_per_week and starts_on = pack.week_start then
    update public.packs
    set pending_rest_days_per_week = null, pending_week_start = null, pending_from = null
    where id = target;
  else
    update public.packs
    set pending_rest_days_per_week = rest_days,
        pending_week_start = starts_on,
        pending_from = (select w.week_to + 1 from public.week_of(pack.week_start, pack.week_changed_on, today) w)
    where id = target;
  end if;
end;
$$;
