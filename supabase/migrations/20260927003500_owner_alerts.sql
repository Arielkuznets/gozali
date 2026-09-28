-- Alerts for the people who run Gozali (owner's request, 2026-09-28): a push when someone finishes
-- signing up, and a summary of the day at 21:00 on their clock. Owners are added by hand, once
-- per project (docs/setup.md):
--   insert into public.app_owners (user_id) values ('<profile id>');
-- Both alerts go through the notifications outbox like every other push.

create table public.app_owners (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Only the functions below read it; the app never does.
alter table public.app_owners enable row level security;
revoke all on public.app_owners from anon, authenticated;

-- Someone finished the profile setup (a name and the terms): every owner hears about it, except
-- the new user themselves.
create function public.notify_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, payload)
  select o.user_id, 'new_user', jsonb_build_object(
    'name', new.display_name,
    'number', (select count(*) from public.profiles p where p.terms_accepted_at is not null)
  )
  from public.app_owners o
  where o.user_id <> new.id;
  return new;
end;
$$;

revoke execute on function public.notify_new_user() from public, anon, authenticated;

create trigger on_profile_set_up
  after update of terms_accepted_at on public.profiles
  for each row
  when (old.terms_accepted_at is null and new.terms_accepted_at is not null)
  execute function public.notify_new_user();

-- The day in numbers, queued once per owner between 21:00 and 23:00 on their clock (their quiet
-- hours start at 23:00). The counts cover the owner's calendar day.
create unique index one_daily_summary on public.notifications (user_id, day) where type = 'daily_summary';

create function public.queue_daily_summaries(at_time timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued integer;
begin
  insert into public.notifications (user_id, type, day, payload)
  select o.user_id, 'daily_summary', d.local_date, jsonb_build_object(
    'newUsers', (select count(*) from public.profiles p where p.terms_accepted_at >= d.starts and p.terms_accepted_at < d.ends),
    'users', (select count(*) from public.profiles p where p.terms_accepted_at is not null),
    'feeders', (
      select count(distinct f.user_id) from public.feeds f
      where not f.is_extra and f.created_at >= d.starts and f.created_at < d.ends
    ),
    'packs', (
      select count(distinct f.pack_id) from public.feeds f
      where not f.is_extra and f.created_at >= d.starts and f.created_at < d.ends
    ),
    'reports', (select count(*) from public.reports r where r.created_at >= d.starts and r.created_at < d.ends),
    'errors', (select count(*) from public.app_errors e where e.created_at >= d.starts and e.created_at < d.ends)
  )
  from public.app_owners o
  join public.profiles pr on pr.id = o.user_id
  cross join lateral (select at_time at time zone pr.timezone as local_now) l
  cross join lateral (
    select
      l.local_now::date as local_date,
      l.local_now::date::timestamp at time zone pr.timezone as starts,
      (l.local_now::date + 1)::timestamp at time zone pr.timezone as ends
  ) d
  where l.local_now::time >= '21:00' and l.local_now::time < '23:00'
  on conflict do nothing;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

revoke execute on function public.queue_daily_summaries(timestamptz) from public, anon, authenticated;

select cron.schedule('daily-summaries', '*/10 * * * *', $$select public.queue_daily_summaries()$$);

-- A sign-up at night waits for the morning instead of waking the owner.
create or replace function public.keeps_overnight(kind public.notification_type)
returns boolean
language sql
immutable
as $$
  select kind in ('weekly_recap', 'evolution', 'pet_state', 'still_in', 'new_user', 'daily_summary');
$$;

-- The owner alerts don't count toward the daily cap of 6 pushes, and the cap doesn't drop them:
-- the only change from 20260927001700 is the two type lists in the cap.
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

      if not public.wants(n.prefs, n.type::text) then
        decision := 'drop';
      elsif n.pack_id is not null and not exists (
        select 1 from public.pack_members m where m.pack_id = n.pack_id and m.user_id = n.user_id and m.status <> 'left'
      ) then
        decision := 'drop';
      elsif extract(hour from local_time) >= 23 or extract(hour from local_time) < 7 then
        decision := case when public.keeps_overnight(n.type) then 'wait' else 'drop' end;
      elsif n.type in ('evening_reminder', 'last_one', 'nudge') and (
        not public.counted_on(n.pack_id, n.user_id, pack_date) or public.fed_on(n.pack_id, n.user_id, pack_date)
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
