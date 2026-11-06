-- Nudges reach sleeping members too: waking them is what the nudge next to a sleeping member is
-- for (spec section 7). Only a joker, a declared rest, a pause or a feed that day stops one.

-- Whether a member doesn't have to feed on a day: a joker, a declared rest or a pause.
create function public.excused_on(target uuid, member uuid, pack_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
      select 1 from public.day_passes d where d.pack_id = target and d.user_id = member and d.day = pack_date
    )
    or exists (
      select 1 from public.pauses s where s.pack_id = target and s.user_id = member and pack_date between s.starts_on and s.ends_on
    );
$$;
revoke execute on function public.excused_on(uuid, uuid, date) from public, anon, authenticated;

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
