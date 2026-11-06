-- A block reaches the developer as a report on the member blocked, so it goes out by the report email
-- and counts in the daily summary, whatever version of the app made it. It keeps to one report per
-- person per member: a report the blocker made that day stays as it is, and a day later
-- renew_member_report lets a new block through as a new report. It runs as its owner, so the rules
-- of a report made in the app, such as sharing a pack, never stop the block itself.
create function public.report_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reports (member_id, reporter_id, reason)
  values (new.blocked_id, new.blocker_id, 'Blocked by the reporter')
  on conflict (member_id, reporter_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.report_block() from public, anon, authenticated;
create trigger report_block after insert on public.blocks
  for each row execute function public.report_block();
