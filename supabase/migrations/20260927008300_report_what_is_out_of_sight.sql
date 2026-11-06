-- A report is about a photo in the reporter's pack, whether or not they may still read it: the read
-- policy on feeds drops a photo once reports hid it or its poster was blocked, and it can still be
-- on their screen. Inside the insert policy that read runs as the caller, so the check goes through
-- a function that sees the row.
create function public.can_report_feed(target_feed uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feeds f where f.id = target_feed and public.is_pack_member(f.pack_id)
  );
$$;
revoke execute on function public.can_report_feed(uuid) from public, anon;
grant execute on function public.can_report_feed(uuid) to authenticated;

alter policy "reports: insert own" on public.reports
  with check (
    reporter_id = (select auth.uid())
    and (public.can_report_feed(feed_id) or public.shares_pack_with(member_id))
  );
