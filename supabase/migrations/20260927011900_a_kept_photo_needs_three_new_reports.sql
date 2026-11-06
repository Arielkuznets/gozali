-- Three reports hide a photo until the developer reviews it. A review marks its reports handled
-- (the email's lines do), and a photo the developer kept up hides again only on three new reports,
-- not on the next one.
create or replace function public.handle_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.reports r where r.feed_id = new.feed_id and r.handled_at is null) >= 3 then
    update public.feeds set hidden_at = now() where id = new.feed_id and hidden_at is null;
  end if;
  if (select count(*) from public.reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') <= 20 then
    perform public.call_edge_function('on-report', jsonb_build_object('reportId', new.id));
  end if;
  return new;
end;
$$;
