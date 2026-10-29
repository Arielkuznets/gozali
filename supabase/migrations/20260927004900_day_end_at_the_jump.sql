-- A day ends at the jump when the clocks skip 03:00 (2026-10-29), like zonedTimeToUtc in
-- packages/game-engine. In Chatham the clocks jump from 02:45 to 03:45 on the last Sunday of
-- September, so 03:00 never happens: "at time zone" read it with the offset before the jump,
-- 15 minutes after it, while pack_day had already moved feeds to the next day at the jump. That
-- night the countdown was 15 minutes long and the grace window ran 75 minutes. Where 03:00
-- doesn't happen, the day now ends at the first minute past it. Otherwise the same as in
-- 20260927004600_day_end_first_occurrence.
create or replace function public.day_closes_at(tz text, pack_date date)
returns timestamptz
language sql
stable
as $$
  select case
    when (e.first_end at time zone tz) = l.local_end and e.first_end < e.usual_end then e.first_end
    when (e.usual_end at time zone tz) = l.local_end then e.usual_end
    else (
      select min(t)
      from generate_series(e.usual_end - interval '3 hours', e.usual_end + interval '3 hours', interval '1 minute') t
      where (t at time zone tz) >= l.local_end
    )
  end + interval '60 minutes'
  from (select (pack_date + 1)::timestamp + interval '3 hours' as local_end) l
  cross join lateral (
    select
      l.local_end at time zone tz as usual_end,
      ((l.local_end - interval '1 hour') at time zone tz) + interval '1 hour' as first_end
  ) e;
$$;
