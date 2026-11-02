-- A paused member's feed counts for nothing at the close, so the widget and the pack treat it the
-- way the app does: the member is away, and nobody hears about it. An older app can still send one,
-- and so can a phone that kept it through the start of the pause.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'dan@test.local');
update public.profiles set display_name = 'Noa' where id = '00000000-0000-0000-0000-0000000000a7';
update public.profiles set display_name = 'Dan' where id = '00000000-0000-0000-0000-0000000000b7';
insert into public.packs (id, name, category, rest_days_per_week, timezone, invite_code)
values ('10000000-0000-0000-0000-000000000007', 'Walkers', 'walking', 0, 'UTC', 'WALK2345');
insert into public.critters (pack_id, species) values ('10000000-0000-0000-0000-000000000007', 'kit');
insert into public.pack_members (pack_id, user_id, role, joined_at) values
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a7', 'admin', now() - interval '20 days'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b7', 'member', now() - interval '19 days');
insert into public.widget_tokens (user_id, token_hash) values
  ('00000000-0000-0000-0000-0000000000a7', encode(extensions.digest('noa-widget', 'sha256'), 'hex')),
  ('00000000-0000-0000-0000-0000000000b7', encode(extensions.digest('dan-widget', 'sha256'), 'hex'));
-- Dan has fed before, so he is someone the last-one notice can be for.
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b7', public.pack_day('UTC') - 3);
delete from public.notifications;

insert into public.pauses (pack_id, user_id, starts_on, ends_on)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a7', public.pack_day('UTC') - 1, public.pack_day('UTC') + 5);
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a7', public.pack_day('UTC'));

select is(
  public.widget_state('dan-widget') -> 'packs' -> 0 -> 'members',
  '["away", "waiting"]'::jsonb,
  'the widget has a paused member away, feed or no feed, so it reads 0 of 1 as the app does'
);
select is(
  public.widget_state('noa-widget') -> 'packs' -> 0 -> 'iFed',
  'false'::jsonb,
  'and does not tell that member they fed'
);
select is(
  (select count(*) from public.notifications where type = 'friend_fed'), 0::bigint,
  'nobody hears about a feed that does not count'
);
select is(
  (select count(*) from public.notifications where type = 'last_one'), 0::bigint,
  'and nobody is told they are the last one because of it'
);

-- Dan's own feed goes out as ever, also to a member on a pause.
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000b7', public.pack_day('UTC'));
select is(
  (select payload -> 'feeders' from public.notifications where type = 'friend_fed' and user_id = '00000000-0000-0000-0000-0000000000a7'),
  '["00000000-0000-0000-0000-0000000000b7"]'::jsonb,
  'a feed that counts is still heard about'
);
select is(
  public.widget_state('dan-widget') -> 'packs' -> 0 -> 'members',
  '["away", "fed"]'::jsonb,
  'and counts on the widget'
);

-- A pause that starts tomorrow, or one that ended yesterday, doesn't touch today.
delete from public.notifications;
delete from public.feeds;
update public.pauses set starts_on = public.pack_day('UTC') + 1;
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a7', public.pack_day('UTC'));
select is(
  (select count(*) from public.notifications where type = 'friend_fed'), 1::bigint,
  'a pause waiting to start keeps the feed of today heard about'
);
select is(
  public.widget_state('noa-widget') -> 'packs' -> 0 -> 'iFed',
  'true'::jsonb,
  'and counted'
);

delete from public.notifications;
delete from public.feeds;
update public.pauses set starts_on = public.pack_day('UTC') - 6, ends_on = public.pack_day('UTC') - 1;
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a7', public.pack_day('UTC'));
select is(
  (select count(*) from public.notifications where type = 'friend_fed'), 1::bigint,
  'a pause that is over does too'
);
select is(
  public.widget_state('dan-widget') -> 'packs' -> 0 -> 'members',
  '["fed", "waiting"]'::jsonb,
  'and has the member back on the widget'
);

-- A feed the grace window took for the last day of a pause counts by its own day, not by today.
delete from public.notifications;
update public.pauses set ends_on = public.pack_day('UTC') - 1;
insert into public.feeds (pack_id, user_id, day)
values ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a7', public.pack_day('UTC') - 1);
select is(
  (select count(*) from public.notifications where type = 'friend_fed'), 0::bigint,
  'a feed goes by the day it counts for'
);

select * from finish();
rollback;
