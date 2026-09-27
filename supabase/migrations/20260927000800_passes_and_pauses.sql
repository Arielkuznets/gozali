-- Rest days, jokers and pauses (spec section 5): actions members take for themselves.

create function public.require_membership(target uuid, member uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  pack_tz text;
begin
  select p.timezone into pack_tz
  from public.packs p
  join public.pack_members m on m.pack_id = p.id and m.user_id = member and m.status <> 'left'
  where p.id = target;
  if pack_tz is null then
    raise exception 'not_a_member' using errcode = '42501';
  end if;
  return pack_tz;
end;
$$;

-- What the caller can do today in a pack: rest days left, joker, today's pass and pauses.
create function public.my_day_status(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
  rules record;
begin
  select * into rules from public.pack_rules_on(target, today);
  return jsonb_build_object(
    'day', today,
    'restDaysPerWeek', rules.rest_days,
    'restDaysLeft', greatest(0, rules.rest_days - public.rest_days_used(target, caller, today)),
    'jokerAvailable', not exists (
      select 1 from public.day_passes d
      where d.pack_id = target and d.user_id = caller and d.kind = 'joker' and d.month = date_trunc('month', today)::date
    ),
    'passToday', (
      select d.kind from public.day_passes d where d.pack_id = target and d.user_id = caller and d.day = today
    ),
    'fedToday', exists (
      select 1 from public.feeds f
      where f.pack_id = target and f.user_id = caller and f.day = today and not f.is_extra
    ),
    'pause', (
      select jsonb_build_object('startsOn', s.starts_on, 'endsOn', s.ends_on)
      from public.pauses s
      where s.pack_id = target and s.user_id = caller and s.ends_on >= today
      order by s.starts_on
      limit 1
    ),
    'pauseAvailableFrom', (
      select max(s.ends_on) + 30 from public.pauses s
      where s.pack_id = target and s.user_id = caller and s.ends_on < today
      having max(s.ends_on) + 30 > today
    )
  );
end;
$$;

-- A joker or a declared rest, for today only (before 03:00; never for a past day).
create function public.use_day_pass(target uuid, pass public.day_pass_kind)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
  violated text;
begin
  if exists (
    select 1 from public.feeds f where f.pack_id = target and f.user_id = caller and f.day = today and not f.is_extra
  ) then
    raise exception 'already_fed' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.pauses s where s.pack_id = target and s.user_id = caller and today between s.starts_on and s.ends_on
  ) then
    raise exception 'paused' using errcode = 'P0001';
  end if;
  if pass = 'rest' and (
    select rules.rest_days - public.rest_days_used(target, caller, today) from public.pack_rules_on(target, today) rules
  ) <= 0 then
    raise exception 'no_rest_days_left' using errcode = 'P0001';
  end if;

  insert into public.day_passes (pack_id, user_id, day, kind) values (target, caller, today, pass);
exception when unique_violation then
  get stacked diagnostics violated = constraint_name;
  if violated = 'one_joker_per_month' then
    raise exception 'joker_used' using errcode = 'P0001';
  end if;
  raise exception 'already_passed' using errcode = 'P0001';
end;
$$;

-- Takes back today's joker or rest; a joker returns to the month.
create function public.cancel_day_pass(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
begin
  delete from public.day_passes where pack_id = target and user_id = caller and day = today;
end;
$$;

-- A pause of 3 to 60 days starting tomorrow (an absence today is what the joker is for), at
-- most one at a time and 30 days after the previous one ended. Pausing also wakes a sleeper.
create function public.start_pause(target uuid, days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
begin
  if days not between 3 and 60 then
    raise exception 'pause_length' using errcode = '22023';
  end if;
  if exists (select 1 from public.pauses s where s.pack_id = target and s.user_id = caller and s.ends_on >= today) then
    raise exception 'already_paused' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.pauses s where s.pack_id = target and s.user_id = caller and s.ends_on + 30 > today) then
    raise exception 'pause_cooldown' using errcode = 'P0001';
  end if;

  insert into public.pauses (pack_id, user_id, starts_on, ends_on) values (target, caller, today + 1, today + days);
  update public.pack_members set status = 'active', awake_since = today + 1
  where pack_id = target and user_id = caller and status = 'sleeping';
end;
$$;

-- Ends a pause: one that hasn't started is cancelled; a running one ends today, so the member
-- counts again from today, but only after at least 3 paused days.
create function public.end_pause(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  today date := public.pack_day(public.require_membership(target, caller));
  current_pause public.pauses;
begin
  select * into current_pause from public.pauses s
  where s.pack_id = target and s.user_id = caller and s.ends_on >= today
  order by s.starts_on
  limit 1;
  if current_pause.id is null then
    raise exception 'not_paused' using errcode = 'P0001';
  end if;
  if current_pause.starts_on > today then
    delete from public.pauses where id = current_pause.id;
  elsif today - current_pause.starts_on < 3 then
    raise exception 'pause_too_short' using errcode = 'P0001';
  else
    update public.pauses set ends_on = today - 1 where id = current_pause.id;
  end if;
end;
$$;

revoke execute on function public.require_membership(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.my_day_status(uuid) from public, anon;
revoke execute on function public.use_day_pass(uuid, public.day_pass_kind) from public, anon;
revoke execute on function public.cancel_day_pass(uuid) from public, anon;
revoke execute on function public.start_pause(uuid, integer) from public, anon;
revoke execute on function public.end_pause(uuid) from public, anon;
grant execute on function public.my_day_status(uuid) to authenticated;
grant execute on function public.use_day_pass(uuid, public.day_pass_kind) to authenticated;
grant execute on function public.cancel_day_pass(uuid) to authenticated;
grant execute on function public.start_pause(uuid, integer) to authenticated;
grant execute on function public.end_pause(uuid) to authenticated;

-- Dashed circles for rest and joker show up live.
alter publication supabase_realtime add table public.day_passes;
