-- Feeding (spec section 6): a private bucket for photos and submit_feed, which saves a feed
-- together with its effects on the member and the day, in one transaction.

-- The pack day from which a member's misses count toward sleep; set when they wake up, so the
-- count starts over (spec section 5). Null means since they joined.
alter table public.pack_members add column awake_since date;

-- The moment a pack day stops taking feeds: its end (03:00 the next morning, local time) plus
-- the one-hour grace window for feeds captured offline.
create function public.day_closes_at(tz text, pack_date date)
returns timestamptz
language sql
stable
as $$
  select ((pack_date + 1)::timestamp + interval '3 hours') at time zone tz + interval '60 minutes';
$$;

-- The day a feed counts for. Server time decides, except for a feed captured offline before its
-- day ended that arrives within the grace window. Mirrors feedDay in packages/game-engine.
create function public.feed_day(tz text, received_at timestamptz, captured_at timestamptz)
returns date
language sql
stable
as $$
  select case
    when captured_at is not null
      and captured_at <= received_at
      and public.pack_day(tz, captured_at) <> public.pack_day(tz, received_at)
      and received_at <= public.day_closes_at(tz, public.pack_day(tz, captured_at))
    then public.pack_day(tz, captured_at)
    else public.pack_day(tz, received_at)
  end;
$$;

-- Photos are private (spec section 11): the app shows them through short-lived signed links.
-- Compressed on the device to 1080px JPEG, so 3 MB is plenty.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feed-photos', 'feed-photos', false, 3145728, array['image/jpeg']);

-- Photos live at <pack id>/<user id>/<file>. Members upload into their own folder of a pack
-- they are in, and read the photos of their packs.
create policy "feed photos: members upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feed-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.is_pack_member(((storage.foldername(name))[1])::uuid)
  );
create policy "feed photos: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'feed-photos' and public.is_pack_member(((storage.foldername(name))[1])::uuid));

-- Saves a feed whose photo is already uploaded. The first feed of the day counts; later ones
-- are extra posts. `taken_at` is the capture time from the phone, trusted only for the offline
-- rule. Returns the feed id.
create function public.submit_feed(
  target uuid,
  photo text,
  note text default null,
  taken_at timestamptz default null,
  focus smallint default null,
  extra boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  pack_tz text;
  standing public.member_status;
  counted_day date;
  created uuid;
begin
  select p.timezone, m.status into pack_tz, standing
  from public.packs p
  join public.pack_members m on m.pack_id = p.id and m.user_id = caller
  where p.id = target;
  if pack_tz is null or standing = 'left' then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if split_part(photo, '/', 1) <> target::text
    or split_part(photo, '/', 2) <> caller::text
    or not exists (select 1 from storage.objects o where o.bucket_id = 'feed-photos' and o.name = photo) then
    raise exception 'photo_missing' using errcode = 'P0001';
  end if;

  note := nullif(trim(note), '');
  counted_day := public.feed_day(pack_tz, now(), taken_at);
  -- A day that already closed takes no more feeds; count it for the current day instead.
  if exists (select 1 from public.day_results r where r.pack_id = target and r.day = counted_day) then
    counted_day := public.pack_day(pack_tz);
  end if;

  -- An extra post before the day's counted feed is the counted feed.
  if extra and not exists (
    select 1 from public.feeds f
    where f.pack_id = target and f.user_id = caller and f.day = counted_day and not f.is_extra
  ) then
    extra := false;
  end if;

  if extra then
    insert into public.feeds (pack_id, user_id, photo_path, caption, day, is_extra, focus_minutes, captured_at)
    values (target, caller, photo, note, counted_day, true, focus, taken_at)
    returning id into created;
    return created;
  end if;

  begin
    insert into public.feeds (pack_id, user_id, photo_path, caption, day, focus_minutes, captured_at)
    values (target, caller, photo, note, counted_day, focus, taken_at)
    returning id into created;
  exception when unique_violation then
    -- The unique index lets only one counted feed per day through, even from a double tap.
    raise exception 'already_fed' using errcode = 'P0001';
  end;

  -- Feeding wakes a sleeping member, who counts on this same day.
  update public.pack_members
  set status = 'active', awake_since = counted_day
  where pack_id = target and user_id = caller and status = 'sleeping';

  -- Feeding cancels today's joker or declared rest, which goes back to the member.
  delete from public.day_passes
  where pack_id = target and user_id = caller and day = counted_day;

  return created;
end;
$$;

revoke execute on function public.submit_feed(uuid, text, text, timestamptz, smallint, boolean) from public, anon;
grant execute on function public.submit_feed(uuid, text, text, timestamptz, smallint, boolean) to authenticated;

-- Member circles light up for everyone as soon as someone feeds.
alter publication supabase_realtime add table public.feeds;
