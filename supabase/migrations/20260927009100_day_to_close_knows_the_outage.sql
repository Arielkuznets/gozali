-- The close of a day the service was down for excuses a miss, so the close's input that members_today
-- hands over says whether the day is one: the game engine reads the same answer on the app as at
-- the close.
create or replace function public.members_today(target uuid)
returns jsonb
language plpgsql
stable security definer
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
      'outage', public.outage_on(target, next_day),
      'members', (
        select coalesce(jsonb_agg(m - 'fedAtMinute'), '[]'::jsonb)
        from jsonb_array_elements(closing -> 'members') m
      )
    ) end
  );
end;
$$;
