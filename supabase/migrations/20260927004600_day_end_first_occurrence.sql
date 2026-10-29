-- A day ends at the first 03:00 when the clocks go back over it (2026-10-29), like zonedTimeToUtc
-- in packages/game-engine. In zones that move 04:00 back to 03:00 (Europe/Athens, Europe/Kyiv),
-- 03:00 happens twice and "at time zone" picks the second one, so that day closed an hour late
-- and its grace window ran an hour long, while pack_day had already moved feeds to the next day.
-- The hour before the end is never repeated in those zones, so stepping back an hour, converting
-- and stepping forward again lands on the first 03:00; it is used only when it really shows 03:00
-- (in a zone that skips from 02:00 to 03:00 it doesn't).
create or replace function public.day_closes_at(tz text, pack_date date)
returns timestamptz
language sql
stable
as $$
  select case
    when (e.first_end at time zone tz) = l.local_end and e.first_end < e.usual_end then e.first_end
    else e.usual_end
  end + interval '60 minutes'
  from (select (pack_date + 1)::timestamp + interval '3 hours' as local_end) l
  cross join lateral (
    select
      l.local_end at time zone tz as usual_end,
      ((l.local_end - interval '1 hour') at time zone tz) + interval '1 hour' as first_end
  ) e;
$$;
