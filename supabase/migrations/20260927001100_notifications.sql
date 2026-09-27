-- Notifications (spec section 8). Actions write rows to the notifications outbox in their own
-- transaction; this migration adds the rows that come from feeds and from the clock, and the
-- rules the send-push function applies before anything reaches a phone.

-- The pack day a once-a-day notification is about (the evening reminder and "last one").
alter table public.notifications add column day date;
create unique index one_daily_notification on public.notifications (user_id, pack_id, type, day)
  where type in ('evening_reminder', 'last_one');

-- Types that still matter in the morning are held over quiet hours; the rest are dropped.
create function public.keeps_overnight(kind public.notification_type)
returns boolean
language sql
immutable
as $$
  select kind in ('weekly_recap', 'evolution', 'pet_state', 'still_in');
$$;

-- Whether a member counts on a pack day: not asleep, not paused, no joker or declared rest.
create function public.counted_on(target uuid, member uuid, pack_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
      select 1 from public.pack_members m where m.pack_id = target and m.user_id = member and m.status = 'active'
    )
    and not exists (
      select 1 from public.day_passes d where d.pack_id = target and d.user_id = member and d.day = pack_date
    )
    and not exists (
      select 1 from public.pauses s where s.pack_id = target and s.user_id = member and pack_date between s.starts_on and s.ends_on
    );
$$;

create function public.fed_on(target uuid, member uuid, pack_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.feeds f where f.pack_id = target and f.user_id = member and f.day = pack_date and not f.is_extra
  );
$$;

-- A counted feed tells the others (merged per member and pack for up to 10 minutes, so three
-- feeds become "3 friends fed Pixel"), and tells the one member still missing that they're last.
create function public.notify_feed()
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
    update public.notifications
    set payload = jsonb_set(payload, '{feeders}', (payload -> 'feeders') || to_jsonb(new.user_id))
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
    and exists (select 1 from public.feeds f where f.pack_id = new.pack_id and f.user_id = m.user_id and not f.is_extra);
  if cardinality(remaining) = 1 then
    insert into public.notifications (user_id, pack_id, type, day)
    values (remaining[1], new.pack_id, 'last_one', new.day)
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger feed_notifications after insert on public.feeds
  for each row execute function public.notify_feed();

-- Evening reminders, queued every few minutes by pg_cron: at the member's reminder time on the
-- pack day, or two hours before the day ends when that time falls outside the pack day (a member
-- in another time zone). Once per member, pack and day.
create function public.queue_evening_reminders(at_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  insert into public.notifications (user_id, pack_id, type, day)
  select m.user_id, p.id, 'evening_reminder', t.pack_date
  from public.packs p
  join public.pack_members m on m.pack_id = p.id and m.status = 'active'
  join public.profiles pr on pr.id = m.user_id
  cross join lateral (
    select
      public.pack_day(p.timezone, at_time) as pack_date,
      public.day_closes_at(p.timezone, public.pack_day(p.timezone, at_time)) - interval '60 minutes' as day_end
  ) t
  cross join lateral (
    select ((t.pack_date::timestamp + pr.reminder_time) at time zone pr.timezone) as wanted
  ) w
  cross join lateral (
    select case
      when w.wanted < t.day_end - interval '1 day' or w.wanted >= t.day_end then t.day_end - interval '2 hours'
      else w.wanted
    end as remind_at
  ) r
  where public.pack_first_day(p.id) is not null
    and at_time >= r.remind_at
    and at_time < t.day_end
    and coalesce((pr.notification_prefs ->> 'evening_reminder')::boolean, true)
    and public.counted_on(p.id, m.user_id, t.pack_date)
    and not public.fed_on(p.id, m.user_id, t.pack_date)
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

-- Decides what goes out now (spec section 8) and marks it: a type the member turned off is
-- dropped; in their quiet hours (23:00-07:00) morning-worthy types wait until 07:00 and the
-- rest are dropped; reminders, "last one" and nudges are dropped once the member isn't counted
-- or already fed; past 6 a day only reminders and "last one" still go (friend-fed doesn't count).
-- Returns what to send, with the names and the critter the texts need and the member's devices.
create function public.claim_notifications(at_time timestamptz default now(), max_rows integer default 200)
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
    local_time := at_time at time zone n.user_tz;
    pack_date := coalesce(n.day, public.pack_day(coalesce(n.pack_tz, n.user_tz), at_time));
    decision := 'send';

    if not coalesce((n.prefs ->> n.type::text)::boolean, true) then
      decision := 'drop';
    elsif extract(hour from local_time) >= 23 or extract(hour from local_time) < 7 then
      decision := case when public.keeps_overnight(n.type) then 'wait' else 'drop' end;
    elsif n.type in ('evening_reminder', 'last_one', 'nudge') and (
      not public.counted_on(n.pack_id, n.user_id, pack_date) or public.fed_on(n.pack_id, n.user_id, pack_date)
    ) then
      decision := 'drop';
    elsif n.type not in ('evening_reminder', 'last_one', 'friend_fed') then
      select count(*) into sent_today
      from public.notifications s
      where s.user_id = n.user_id and s.status = 'sent' and s.type <> 'friend_fed'
        and (s.sent_at at time zone n.user_tz)::date = local_time::date;
      if sent_today >= 6 then
        decision := 'drop';
      end if;
    end if;

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
          select coalesce(array_agg(coalesce(pr.display_name, '…') order by who.position), '{}')
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

-- When the push service can't take a batch, the rows go back to pending for the next run.
create function public.requeue_notifications(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications set status = 'pending', sent_at = null where id = any (ids);
$$;

create function public.forget_push_tokens(dead text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (dead);
$$;

revoke execute on function public.keeps_overnight(public.notification_type) from public, anon, authenticated;
revoke execute on function public.counted_on(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.fed_on(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function public.notify_feed() from public, anon, authenticated;
revoke execute on function public.queue_evening_reminders(timestamptz) from public, anon, authenticated;
revoke execute on function public.claim_notifications(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.requeue_notifications(uuid[]) from public, anon, authenticated;
revoke execute on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.queue_evening_reminders(timestamptz) to service_role;
grant execute on function public.claim_notifications(timestamptz, integer) to service_role;
grant execute on function public.requeue_notifications(uuid[]) to service_role;
grant execute on function public.forget_push_tokens(text[]) to service_role;

-- One way to call any scheduled Edge Function: the base address and the shared secret live in
-- Vault ('functions_url', like https://<project>.supabase.co/functions/v1, and 'cron_secret').
-- Replaces call_close_days from the scheduling migration.
create function public.call_edge_function(name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := (select decrypted_secret from vault.decrypted_secrets where vault.decrypted_secrets.name = 'functions_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where vault.decrypted_secrets.name = 'cron_secret');
begin
  if base_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/' || name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.call_edge_function(text) from public, anon, authenticated;

select cron.unschedule('close-days');
drop function public.call_close_days();
select cron.schedule('close-days', '*/15 * * * *', $$select public.call_edge_function('close-days')$$);
select cron.schedule('send-push', '* * * * *', $$select public.call_edge_function('send-push')$$);
select cron.schedule('evening-reminders', '*/5 * * * *', $$select public.queue_evening_reminders()$$);
