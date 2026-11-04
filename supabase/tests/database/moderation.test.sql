-- Word filtering, reports on photos and on members, and the helpers of account deletion.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

select ok(public.is_clean('Leg day, done'), 'ordinary captions pass');
select ok(not public.is_clean('what the fuuuck'), 'repeated letters don''t get around the filter');
select ok(not public.is_clean('sh1t happens'), 'nor do digits for letters');
select ok(public.is_clean('Assassin class, then a glass of water'), 'blocked words inside ordinary words are fine');

-- A number is a number, however its digits would read as letters.
select ok(public.is_clean('Read up to page 455'), 'a page number passes');
select ok(public.is_clean('Deadlift 455 lbs!'), 'so does a weight');
select ok(public.is_clean('Room #455'), 'and a number after a sign');
select ok(public.is_clean('8455 steps, 2455 calories'), 'and one with a digit that stands for no letter');

-- Everything else reads as it always did.
select ok(not public.is_clean('a55'), 'digits next to a letter still stand for letters');
select ok(not public.is_clean('4$$'), 'and next to a symbol that stands for a letter');
select ok(not public.is_clean('4$5'), 'with the digits on both sides of it');
select ok(not public.is_clean('8a55 shit2'), 'a digit that stands for no letter still ends a word');
select ok(not public.is_clean('sh1t 455'), 'a number next to a word doesn''t clear the word');
select ok(public.is_clean('קראתי עד עמוד 455'), 'Hebrew with a number passes');
select ok(public.is_clean('עמוד455 מתוך 800'), 'also with the number stuck to a word');
select ok(not public.is_clean('היום a55 ממש'), 'and a blocked word among Hebrew is still caught');

-- Every word on the list, in every mix of letters and the digits that stand for them, is blocked.
-- The one spelling that is all digits is the number.
with recursive spelled (done, rest) as (
  select '', word from public.blocked_words
  union
  select s.done || c.letter, substr(s.rest, 2)
  from spelled s
  cross join lateral (values (left(s.rest, 1)), (translate(left(s.rest, 1), 'oieast', '013457'))) as c (letter)
  where s.rest <> ''
)
select is(
  (select array_agg(done order by done) from spelled where rest = '' and public.is_clean(done)),
  array['455'],
  'no digit spelling of a blocked word passes, but for the plain number'
);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'noa@test.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'dan@test.local'),
  ('00000000-0000-0000-0000-0000000000c7', 'maya@test.local'),
  ('00000000-0000-0000-0000-0000000000d7', 'eli@test.local'),
  ('00000000-0000-0000-0000-0000000000e7', 'eve@test.local');

create function pg_temp.act_as(member uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
$$;
-- The error a statement ends with. A time limit has to be named: others doesn't catch it.
create function pg_temp.error_of(statement text) returns text language plpgsql as $$
begin
  execute statement;
  return 'none';
exception when query_canceled or others then
  return sqlstate;
end;
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
-- Filtering costs time by the word, and every column filtered holds 80 characters at most.
set local statement_timeout = '1s';
select is(
  pg_temp.error_of($$ update public.profiles set display_name = repeat('ab ', 700000) where id = '00000000-0000-0000-0000-0000000000a7' $$),
  '23514',
  'a display name of two megabytes fails its length check within a second'
);
reset statement_timeout;
select throws_ok(
  $$ select public.create_pack('Shit squad', 'gym', 1::smallint, 'mochi', 'UTC') $$,
  '22023', 'text_not_allowed', 'pack names are filtered'
);
select throws_ok(
  $$ update public.profiles set display_name = 'Bitchy' where id = '00000000-0000-0000-0000-0000000000a7' $$,
  '22023', 'text_not_allowed', 'display names are filtered'
);
create temp table pack as select public.create_pack('Gym squad', 'gym', 1::smallint, 'mochi', 'UTC') as id;
create temp table code as select invite_code from public.packs;
grant select on pack, code to authenticated;
reset role;
insert into public.pack_members (pack_id, user_id)
select id, u from pack, unnest(array['00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000d7']::uuid[]) u;
insert into storage.objects (bucket_id, name)
select 'feed-photos', (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a7/' || n || '.jpg' from generate_series(1, 2) n;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select throws_ok(
  $$ select public.submit_feed((select id from pack), (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a7/1.jpg', 'fucking finally') $$,
  '22023', 'text_not_allowed', 'captions are filtered'
);
select lives_ok(
  $$ select public.submit_feed((select id from pack), (select id from pack)::text || '/00000000-0000-0000-0000-0000000000a7/1.jpg', 'Finally!') $$,
  'a clean caption goes through'
);

-- Three reports hide the item.
create temp table feed as select id from public.feeds;
grant select on feed to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
insert into public.reports (feed_id, reporter_id, reason) values ((select id from feed), '00000000-0000-0000-0000-0000000000b7', 'Not a workout');
select lives_ok(
  $$ insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000b7')
     on conflict (feed_id, reporter_id) do nothing $$,
  'reporting the same photo again changes nothing'
);
select is((select count(*) from public.reports), 1::bigint, 'it stays one report');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000c7');
select is((select count(*) from public.feeds), 1::bigint, 'two reports leave the item up');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000d7');
select is((select count(*) from public.feeds), 0::bigint, 'the third report hides it from the pack');
select is(
  (select count(*) from storage.objects where bucket_id = 'feed-photos'), 0::bigint,
  'and its file can''t be listed or downloaded either'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select is(
  (select count(*) from storage.objects where bucket_id = 'feed-photos'), 2::bigint,
  'the author still reads their own files'
);

reset role;
select is(
  (select (d -> 'author' ->> 'id') || ' ' || (d ->> 'reports') || ' ' || (d -> 'feed' ->> 'hidden')
   from public.report_details((select r.id from public.reports r where r.reason = 'Not a workout')) d),
  '00000000-0000-0000-0000-0000000000a7 3 true',
  'the developer''s alert has the author, the report count and the state'
);

-- A member can be reported too, for their name or profile photo.
update public.profiles set avatar_path = '00000000-0000-0000-0000-0000000000a7/me.jpg' where id = '00000000-0000-0000-0000-0000000000a7';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select lives_ok(
  $$ insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000b7')
     on conflict (member_id, reporter_id) do nothing $$,
  'a member reports someone in their pack'
);
select lives_ok(
  $$ insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000b7')
     on conflict (member_id, reporter_id) do nothing $$,
  'and again, which changes nothing'
);
select is(
  (select count(*) from public.reports where member_id = '00000000-0000-0000-0000-0000000000a7'), 1::bigint,
  'one report per person per member'
);

-- A name or a profile photo can change after a report, unlike a photo. After a day the same person
-- can report the member again, and a new report is what reaches the developer.
reset role;
update public.reports set created_at = now() - interval '23 hours' where member_id = '00000000-0000-0000-0000-0000000000a7';
create temp table first_report as select id from public.reports where member_id = '00000000-0000-0000-0000-0000000000a7';
grant select on first_report to authenticated;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000b7')
  on conflict (member_id, reporter_id) do nothing;
select is(
  (select r.id from public.reports r where r.member_id = '00000000-0000-0000-0000-0000000000a7'),
  (select id from first_report),
  'within the day it stays the same report'
);
reset role;
update public.reports set created_at = now() - interval '25 hours' where member_id = '00000000-0000-0000-0000-0000000000a7';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
select throws_ok(
  $$ insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000b7')
     on conflict (member_id, reporter_id) do nothing $$,
  '42501', null, 'nobody else can renew it'
);
reset role;
select is(
  (select r.id from public.reports r where r.member_id = '00000000-0000-0000-0000-0000000000a7'),
  (select id from first_report),
  'which leaves the report where it was'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select lives_ok(
  $$ insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000b7')
     on conflict (member_id, reporter_id) do nothing $$,
  'after a day the same person reports the member again'
);
select is(
  (select count(*) from public.reports where member_id = '00000000-0000-0000-0000-0000000000a7'), 1::bigint,
  'it stays one report per person per member'
);
select isnt(
  (select r.id from public.reports r where r.member_id = '00000000-0000-0000-0000-0000000000a7'),
  (select id from first_report),
  'but a new one, so the developer hears of it'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
select throws_ok(
  $$ insert into public.reports (member_id, reporter_id, created_at)
     values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000c7', now() - interval '2 days') $$,
  '42501', null, 'a request can''t date a report back to get past the day'
);
reset role;
update public.reports set created_at = now() - interval '25 hours' where reason = 'Not a workout';
create temp table photo_report as select id from public.reports where reason = 'Not a workout';
grant select on photo_report to authenticated;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
insert into public.reports (feed_id, reporter_id) select r.feed_id, r.reporter_id from public.reports r where r.id = (select id from photo_report)
  on conflict (feed_id, reporter_id) do nothing;
select is(
  (select r.id from public.reports r where r.reporter_id = '00000000-0000-0000-0000-0000000000b7' and r.feed_id is not null),
  (select id from photo_report),
  'a report on a photo stands for good: a photo doesn''t change'
);

select throws_ok(
  $$ insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7') $$,
  '23514', null, 'nobody reports themselves'
);
select throws_ok(
  $$ insert into public.reports (feed_id, member_id, reporter_id)
     values ((select id from feed), '00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000b7') $$,
  '23514', null, 'a report is about a photo or a member, not both'
);
select throws_ok(
  $$ insert into public.reports (reporter_id) values ('00000000-0000-0000-0000-0000000000b7') $$,
  '42501', null, 'and it is about something'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e7');
select throws_ok(
  $$ insert into public.reports (member_id, reporter_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000e7') $$,
  '42501', null, 'someone outside the pack can''t report its members'
);
reset role;
select is(
  (select (d -> 'author' ->> 'id') || ' ' || (d -> 'author' ->> 'avatarPath') || ' ' || (d ->> 'reports') || ' ' || jsonb_typeof(d -> 'feed')
   from public.report_details((select r.id from public.reports r where r.member_id is not null)) d),
  '00000000-0000-0000-0000-0000000000a7 00000000-0000-0000-0000-0000000000a7/me.jpg 1 null',
  'the developer''s alert names the member and their photo, with no feed'
);
select is(
  (select d ->> 'reports' from public.report_details((select r.id from public.reports r where r.reason = 'Not a workout')) d),
  '3', 'a report on the member doesn''t count toward those on their photo'
);

-- A photo out of a member's sight stays open to their report: it can still be on their screen.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f7', 'ari@test.local');
insert into public.pack_members (pack_id, user_id) select id, '00000000-0000-0000-0000-0000000000f7' from pack;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f7');
select lives_ok(
  $$ insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000f7')
     on conflict (feed_id, reporter_id) do nothing $$,
  'a member can report a photo that reports just hid'
);
select is(
  (select count(*) from public.reports where reporter_id = '00000000-0000-0000-0000-0000000000f7'), 1::bigint,
  'and the report is saved'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select lives_ok(
  $$ insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000d7')
     on conflict (feed_id, reporter_id) do nothing $$,
  'reporting a hidden photo again changes nothing'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e7');
select throws_ok(
  $$ insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000e7') $$,
  '42501', null, 'someone outside the pack can''t report a hidden photo'
);
reset role;
update public.feeds set hidden_at = null where id = (select id from feed);
delete from public.reports where feed_id = (select id from feed) and reporter_id = '00000000-0000-0000-0000-0000000000c7';
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000a7');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
select lives_ok(
  $$ insert into public.reports (feed_id, reporter_id) values ((select id from feed), '00000000-0000-0000-0000-0000000000c7')
     on conflict (feed_id, reporter_id) do nothing $$,
  'a member can report the photo of someone they just blocked'
);

-- Name suggestions carry their author's name, so those of someone a member blocked are out of that
-- member's sight, and only theirs.
reset role;
update public.critters set status = 'active', stage = 'baby', xp = 1, health = 80 where pack_id = (select id from pack);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select public.suggest_name((select id from pack), 'Pixel');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select public.suggest_name((select id from pack), 'Blobby');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
select is(
  (select array_agg(name order by name) from public.name_suggestions), array['Blobby'],
  'a member doesn''t read the name suggestions of someone they blocked'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select is(
  (select array_agg(name order by name) from public.name_suggestions), array['Blobby', 'Pixel'],
  'the rest of the pack still reads them'
);
reset role;

-- A block reaches the developer as a report on the member blocked, with the same email. The Vault
-- holds the functions' address as in production; nothing leaves the transaction, since the queue is
-- read before anything sends it.
select vault.create_secret('http://functions.test', 'functions_url');
select vault.create_secret('test-secret', 'cron_secret');
create function pg_temp.mailed() returns setof uuid language sql as $$
  select (convert_from(q.body, 'utf8')::jsonb ->> 'reportId')::uuid
  from net.http_request_queue q where q.url = 'http://functions.test/on-report';
$$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000b7');
reset role;
create temp table block_report as
  select id, reason from public.reports
  where reporter_id = '00000000-0000-0000-0000-0000000000d7' and member_id = '00000000-0000-0000-0000-0000000000b7';
select is((select array_agg(reason) from block_report), array['Blocked by the reporter'], 'a block is a report on the member blocked');
select is((select count(*) from pg_temp.mailed() m join block_report r on r.id = m), 1::bigint, 'which emails the developer');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
delete from public.blocks where blocked_id = '00000000-0000-0000-0000-0000000000b7';
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000b7');
reset role;
select is(
  (select count(*) from public.reports where reporter_id = '00000000-0000-0000-0000-0000000000d7' and member_id = '00000000-0000-0000-0000-0000000000b7'),
  1::bigint, 'unblocking and blocking again the same day leaves one report'
);
select is((select count(*) from pg_temp.mailed()), 1::bigint, 'and one email');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select lives_ok(
  $$ insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000a7') $$,
  'a block saves when the same person reported that member today'
);
reset role;
select is(
  (select count(*) from public.reports
   where reporter_id = '00000000-0000-0000-0000-0000000000b7' and member_id = '00000000-0000-0000-0000-0000000000a7' and reason is null),
  1::bigint, 'and their own report stays in its place'
);
update public.reports set created_at = now() - interval '25 hours' where id = (select id from block_report);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
delete from public.blocks where blocked_id = '00000000-0000-0000-0000-0000000000b7';
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000b7');
reset role;
select is((select count(*) from pg_temp.mailed()), 2::bigint, 'a day later, blocking again reaches the developer again');

-- One person's reports email the developer up to 20 a day. Past that each is still saved and still
-- counts toward hiding a photo and in the daily summary, which is how the developer hears of it.
insert into public.feeds (pack_id, user_id, day, is_extra)
select (select id from pack), '00000000-0000-0000-0000-0000000000b7', current_date, true from generate_series(1, 22);
create temp table extras as select id, row_number() over (order by id) as n from public.feeds where is_extra;
grant select on extras to authenticated;
create function pg_temp.mailed_from(reporter uuid) returns bigint language sql as $$
  select count(*) from pg_temp.mailed() m join public.reports r on r.id = m where r.reporter_id = reporter;
$$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000a7' from extras where n <= 20;
reset role;
select is(pg_temp.mailed_from('00000000-0000-0000-0000-0000000000a7'), 20::bigint, 'twenty reports in a day each email the developer');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000a7' from extras where n = 21;
reset role;
select is(
  (select count(*) from public.reports where reporter_id = '00000000-0000-0000-0000-0000000000a7'), 21::bigint,
  'the twenty-first is saved'
);
select is(pg_temp.mailed_from('00000000-0000-0000-0000-0000000000a7'), 20::bigint, 'but sends no email');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000c7' from extras where n = 21;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000d7' from extras where n = 21;
reset role;
select is(
  (select count(*) from pg_temp.mailed() m join public.reports r on r.id = m
   where r.feed_id = (select id from extras where n = 21) and r.reporter_id <> '00000000-0000-0000-0000-0000000000a7'),
  2::bigint, 'other people''s reports on the same photo still email the developer'
);
select ok(
  (select hidden_at is not null from public.feeds where id = (select id from extras where n = 21)),
  'and with the one past the cap, three reports hide it'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000f7');
reset role;
select is(
  (select count(*) from public.reports where reporter_id = '00000000-0000-0000-0000-0000000000a7' and member_id = '00000000-0000-0000-0000-0000000000f7')
  || ' ' || pg_temp.mailed_from('00000000-0000-0000-0000-0000000000a7'),
  '1 20', 'a block past the cap is still a report, with no email'
);
update public.reports set created_at = now() - interval '25 hours' where reporter_id = '00000000-0000-0000-0000-0000000000a7';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000a7' from extras where n = 22;
reset role;
select is(pg_temp.mailed_from('00000000-0000-0000-0000-0000000000a7'), 21::bigint, 'a day later their reports email the developer again');

-- A photo the developer reviewed and kept, by the email's line that marks its reports handled and
-- shows it again, stays up until three new reports hide it.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007a1', 'gil@test.local'),
  ('00000000-0000-0000-0000-0000000007b1', 'hila@test.local');
insert into public.pack_members (pack_id, user_id)
select id, u from pack, unnest(array['00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-0000000007b1']::uuid[]) u;
create temp table kept (id uuid);
with posted as (
  insert into public.feeds (pack_id, user_id, day, is_extra)
  values ((select id from pack), '00000000-0000-0000-0000-0000000000b7', current_date, true) returning id
)
insert into kept select id from posted;
grant select on kept to authenticated;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000c7' from kept;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000d7' from kept;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000f7' from kept;
reset role;
select ok((select hidden_at is not null from public.feeds where id = (select id from kept)), 'three reports hide a photo');
update public.reports set handled_at = now() where feed_id = (select id from kept);
update public.feeds set hidden_at = null where id = (select id from kept);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000000a7' from kept;
reset role;
select ok(
  (select hidden_at is null from public.feeds where id = (select id from kept)),
  'once the developer kept it, one more report leaves it up'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000007a1' from kept;
reset role;
select ok((select hidden_at is null from public.feeds where id = (select id from kept)), 'and so does a second');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000007b1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000007b1' from kept;
reset role;
select ok((select hidden_at is not null from public.feeds where id = (select id from kept)), 'the third new report hides it again');

select is(
  (select count(*) from public.account_photo_paths('00000000-0000-0000-0000-0000000000a7')), 2::bigint,
  'all of a member''s photo files are found for deletion'
);

-- A pack whose members all left is dropped 30 days later, unless someone joins it again.
update public.pack_members set status = 'left', left_at = now(), role = 'member' where pack_id = (select id from pack);
select ok(
  (select id from pack) not in (select public.empty_packs(now() + interval '29 days')),
  'an empty pack waits 30 days'
);
select ok((select id from pack) in (select public.empty_packs(now() + interval '31 days')), 'then it is due');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d7');
select public.join_pack((select invite_code from code));
reset role;
select is(
  (select role::text from public.pack_members where pack_id = (select id from pack) and user_id = '00000000-0000-0000-0000-0000000000d7'),
  'admin', 'whoever joins an empty pack becomes its admin'
);
select ok((select id from pack) not in (select public.empty_packs(now() + interval '31 days')), 'and it is kept');
update public.pack_members set status = 'left', left_at = now(), role = 'member' where pack_id = (select id from pack);
select ok(public.drop_empty_packs(now() + interval '31 days') >= 1, 'an empty pack is removed after 30 days');
select is((select count(*) from public.packs where id = (select id from pack)), 0::bigint, 'and gone');

select * from finish();
rollback;
