-- A report is about a photo or about a member: a name or a profile photo has no feed to point at.
-- It stays one report per person per member, as for a photo, which also keeps a crafted request from
-- flooding the developer's mail. A report on a member hides nothing by itself (handle_report counts
-- reports on a feed); the developer decides.
alter table public.reports
  alter column feed_id drop not null,
  add column member_id uuid references public.profiles (id) on delete cascade,
  add constraint reports_one_target check (num_nonnulls(feed_id, member_id) = 1),
  add constraint reports_not_yourself check (member_id <> reporter_id),
  add constraint reports_member_id_reporter_id_key unique (member_id, reporter_id);

drop policy "reports: insert own" on public.reports;
create policy "reports: insert own" on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and (
      exists (select 1 from public.feeds f where f.id = feed_id and public.is_pack_member(f.pack_id))
      or public.shares_pack_with(member_id)
    )
  );

-- A report on a member has no feed: `author` is then the member, and `feed` is null.
create or replace function public.report_details(report uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reportId', r.id,
    'reason', r.reason,
    'reportedAt', r.created_at,
    'reporter', jsonb_build_object('id', reporter.id, 'name', reporter.display_name),
    'feed', case when f.id is not null then jsonb_build_object(
      'id', f.id, 'caption', f.caption, 'photoPath', f.photo_path, 'hidden', f.hidden_at is not null,
      'postedAt', f.created_at, 'packId', f.pack_id
    ) end,
    'author', jsonb_build_object('id', author.id, 'name', author.display_name, 'avatarPath', author.avatar_path),
    'reports', (select count(*) from public.reports x where x.feed_id = r.feed_id or x.member_id = r.member_id)
  )
  from public.reports r
  left join public.feeds f on f.id = r.feed_id
  join public.profiles reporter on reporter.id = r.reporter_id
  join public.profiles author on author.id = coalesce(r.member_id, f.user_id)
  where r.id = report;
$$;
revoke execute on function public.report_details(uuid) from public, anon, authenticated;
grant execute on function public.report_details(uuid) to service_role;
