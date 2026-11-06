-- One person's reports email the developer up to 20 a day. The mail service's free plan sends 100 a
-- day, and a mail it refuses is not sent again, so one person reporting everything they can see
-- would keep everyone else's reports from arriving. Past 20 a report is still saved, still counts
-- toward hiding a photo, and reaches the developer through the daily summary. A day, not an hour:
-- 10 an hour would still let 240 through. All the rows of one insert are counted together, so a
-- crafted bulk of more than 20 emails none of them.
create or replace function public.handle_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.reports r where r.feed_id = new.feed_id) >= 3 then
    update public.feeds set hidden_at = now() where id = new.feed_id and hidden_at is null;
  end if;
  if (select count(*) from public.reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') <= 20 then
    perform public.call_edge_function('on-report', jsonb_build_object('reportId', new.id));
  end if;
  return new;
end;
$$;
