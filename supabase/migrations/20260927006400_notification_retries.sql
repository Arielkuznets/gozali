-- A notification that goes back in the queue waits before its next try, twice as long each time
-- starting at a minute, and is dropped after eight tries (2026-11-01). A run claims the 200 rows
-- that have been due the longest, so rows the push service keeps refusing would otherwise fill
-- every run and hold up everyone behind them. Eight tries span about two hours, long enough to
-- ride out a passing outage of the push service.
alter table public.notifications add column attempts integer not null default 0;

create or replace function public.requeue_notifications(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
  set status = 'pending', sent_at = null, attempts = attempts + 1,
      send_after = now() + interval '1 minute' * 2 ^ attempts
  where id = any (ids);
$$;

create or replace function public.claim_notifications(at_time timestamptz default now(), max_rows integer default 200)
returns table (
  id uuid,
  user_id uuid,
  pack_id uuid,
  type public.notification_type,
  payload jsonb,
  locale text,
  pack_name text,
  critter_name text,
  species public.critter_species,
  names text[],
  tokens text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n record;
  local_time timestamp;
  pack_date date;
  sent_today integer;
  decision text;
begin
  for n in
    select x.*, pr.timezone as user_tz, pr.locale as user_locale, pr.notification_prefs as prefs, p.timezone as pack_tz
    from public.notifications x
    join public.profiles pr on pr.id = x.user_id
    left join public.packs p on p.id = x.pack_id
    where x.status = 'pending' and x.send_after <= at_time
    order by x.send_after
    limit max_rows
    for update of x skip locked
  loop
    begin
      local_time := at_time at time zone n.user_tz;
      pack_date := coalesce(n.day, public.pack_day(coalesce(n.pack_tz, n.user_tz), at_time));
      decision := 'send';

      if n.attempts >= 8 then
        decision := 'drop';
      elsif not public.wants(n.prefs, n.type::text) then
        decision := 'drop';
      elsif n.pack_id is not null and not exists (
        select 1 from public.pack_members m where m.pack_id = n.pack_id and m.user_id = n.user_id and m.status <> 'left'
      ) then
        decision := 'drop';
      elsif extract(hour from local_time) >= 23 or extract(hour from local_time) < 7 then
        decision := case when public.keeps_overnight(n.type) then 'wait' else 'drop' end;
      elsif n.type in ('evening_reminder', 'last_one') and (
        not public.counted_on(n.pack_id, n.user_id, pack_date) or public.fed_on(n.pack_id, n.user_id, pack_date)
      ) then
        decision := 'drop';
      elsif n.type = 'nudge' and (
        public.excused_on(n.pack_id, n.user_id, pack_date) or public.fed_on(n.pack_id, n.user_id, pack_date)
      ) then
        decision := 'drop';
      elsif n.type not in ('evening_reminder', 'last_one', 'friend_fed', 'new_user', 'daily_summary') then
        select count(*) into sent_today
        from public.notifications s
        where s.user_id = n.user_id and s.status = 'sent' and s.type not in ('friend_fed', 'new_user', 'daily_summary')
          and s.sent_at >= at_time - interval '1 day'
          and (s.sent_at at time zone n.user_tz)::date = local_time::date;
        if sent_today >= 6 then
          decision := 'drop';
        end if;
      end if;
    exception when others then
      decision := 'drop';
    end;

    if decision = 'wait' then
      update public.notifications x
      set send_after = (
        (local_time::date + case when extract(hour from local_time) >= 23 then 1 else 0 end)::timestamp
        + interval '7 hours'
      ) at time zone n.user_tz
      where x.id = n.id;
    elsif decision = 'drop' then
      update public.notifications x set status = 'dropped' where x.id = n.id;
    else
      update public.notifications x set status = 'sent', sent_at = at_time where x.id = n.id;
      return query
      select
        n.id, n.user_id, n.pack_id, n.type, n.payload, n.user_locale,
        (select p.name from public.packs p where p.id = n.pack_id),
        (select c.name from public.critters c where c.pack_id = n.pack_id),
        (select c.species from public.critters c where c.pack_id = n.pack_id),
        (
          select coalesce(array_agg(coalesce(pr.display_name, '...') order by who.position), '{}')
          from jsonb_array_elements_text(
            coalesce(n.payload -> 'feeders', '[]'::jsonb) || coalesce(to_jsonb(n.payload ->> 'from'), '[]'::jsonb)
          ) with ordinality as who (member, position)
          join public.profiles pr on pr.id::text = who.member
        ),
        (select coalesce(array_agg(t.token), '{}') from public.push_tokens t where t.user_id = n.user_id);
    end if;
  end loop;
end;
$$;

-- A token has to pass Expo's own check (isExpoPushToken in its server SDK): one of the two bracket
-- forms or a UUID. Rows already in the table stay.
create or replace function public.register_push_token(device_token text, device public.push_platform)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
begin
  if device_token is null or char_length(device_token) not between 1 and 200
    or device_token !~ '^((Exponent|Expo)PushToken\[.*\]|[a-zA-Z0-9]{8}(-[a-zA-Z0-9]{4}){3}-[a-zA-Z0-9]{12})$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (device_token, caller, device, now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;
