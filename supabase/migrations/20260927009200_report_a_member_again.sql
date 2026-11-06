-- A photo can't change, so one report per person per photo is enough. A member's name and profile
-- photo can, and a repeat that does nothing means nobody hears of the new one, while the app says it
-- will be looked at. After a day a new report from the same person takes the old one's place. The
-- unique key the app's upsert relies on stays, and with it one mail a day per person per member.
-- The old report's mail has gone out, and nothing else points at its row. The day runs on
-- created_at, so a request can't write that column, or send more than the app does.
create function public.renew_member_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.member_id is not null then
    delete from public.reports r
    where r.member_id = new.member_id and r.reporter_id = new.reporter_id
      and r.created_at < now() - interval '1 day';
  end if;
  return new;
end;
$$;
revoke execute on function public.renew_member_report() from public, anon, authenticated;
create trigger renew_member_report before insert on public.reports
  for each row execute function public.renew_member_report();

revoke insert on public.reports from authenticated;
grant insert (feed_id, member_id, reporter_id, reason) on public.reports to authenticated;
