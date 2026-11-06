-- What the pack screen can't see of today's close, for the hatch steps (spec section 4): whether
-- each member has started and the rest days they used this week, as the day close gets them.
create function public.members_today(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'restDaysPerWeek', input -> 'restDaysPerWeek',
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', m -> 'userId',
        'membership', m -> 'membership',
        'hasStarted', m -> 'hasStarted',
        'restDaysUsedThisWeek', m -> 'restDaysUsedThisWeek'
      )), '[]'::jsonb)
      from jsonb_array_elements(input -> 'members') m
    )
  )
  from (
    select public.day_close_input(target, public.pack_day(public.require_membership(target, public.require_user()))) as input
  ) today;
$$;
revoke execute on function public.members_today(uuid) from public, anon;
grant execute on function public.members_today(uuid) to authenticated;
