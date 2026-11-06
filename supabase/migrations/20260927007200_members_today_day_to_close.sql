-- Only a day's close records an automatic rest, so between the end of a day and its close a member
-- can look able to rest when they have no rest day left. rest_days_used stays a count of what
-- happened: it feeds the close itself, and what an open day will spend is for the game engine to
-- say, since a feed can still arrive in the grace window and an outage spends nothing. So
-- members_today says which day it answers for and hands over the close's input for the oldest day
-- without a result: the app promises nothing about today until that day closes, and the engine can
-- read what its close will do. The input goes without the minute anyone fed: like counted_feeds,
-- this says who and which day.
create or replace function public.members_today(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := public.pack_day(public.require_membership(target, public.require_user()));
  input jsonb := public.day_close_input(target, today);
  next_day date := coalesce(
    (select max(r.day) + 1 from public.day_results r where r.pack_id = target),
    public.pack_first_day(target)
  );
  closing jsonb;
begin
  if next_day < today then
    closing := public.day_close_input(target, next_day);
  end if;
  return jsonb_build_object(
    'day', today,
    'restDaysPerWeek', input -> 'restDaysPerWeek',
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', m -> 'userId',
        'membership', m -> 'membership',
        'hasStarted', m -> 'hasStarted',
        'restDaysUsedThisWeek', m -> 'restDaysUsedThisWeek'
      )), '[]'::jsonb)
      from jsonb_array_elements(input -> 'members') m
    ),
    'dayToClose', case when closing is not null then jsonb_build_object(
      'day', next_day,
      'critter', closing -> 'critter',
      'restDaysPerWeek', closing -> 'restDaysPerWeek',
      'members', (
        select coalesce(jsonb_agg(m - 'fedAtMinute'), '[]'::jsonb)
        from jsonb_array_elements(closing -> 'members') m
      )
    ) end
  );
end;
$$;
