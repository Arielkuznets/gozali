-- A photo that reports hid stays hidden until the developer reviews it, and the email is how the
-- developer hears of it. So the report that hides a photo emails even past its reporter's 20 a day;
-- the others past it still reach the developer through the daily summary only. Only the report that
-- hides it does: a photo already hidden hides no further.
create or replace function public.handle_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid boolean := false;
begin
  if (select count(*) from public.reports r where r.feed_id = new.feed_id and r.handled_at is null) >= 3 then
    update public.feeds set hidden_at = now() where id = new.feed_id and hidden_at is null;
    hid := found;
  end if;
  if hid or (select count(*) from public.reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') <= 20 then
    perform public.call_edge_function('on-report', jsonb_build_object('reportId', new.id));
  end if;
  return new;
end;
$$;
