-- A feed sent again gets back the feed it already made (2026-10-29). When the answer to
-- submit_feed is lost (the connection drops after the server saved the feed), the app keeps the
-- feed and sends it again later with the same photo. The retry ran into the feed it had made
-- itself: as the day's counted feed it was turned down as already_fed, so the app deleted the photo
-- file that the saved feed shows, uploaded it again and posted it a second time as an extra (and if
-- that second upload failed, the saved feed was left without its photo); an extra post was simply
-- saved twice. The photo's name carries the feed's id from the phone, so a feed of the caller's
-- with the same photo is that feed, and its id comes back. Otherwise the same as in
-- 20260927001700_review_fixes.
create or replace function public.submit_feed(
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
  select f.id into created from public.feeds f where f.user_id = caller and f.photo_path = photo limit 1;
  if created is not null then
    return created;
  end if;

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
    if (
      select count(*) from public.feeds f
      where f.pack_id = target and f.user_id = caller and f.day = counted_day and f.is_extra
    ) >= 5 then
      raise exception 'too_many_posts' using errcode = 'P0001';
    end if;
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
