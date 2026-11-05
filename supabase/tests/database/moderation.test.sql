-- Word filtering, reports on photos and on members, and the helpers of account deletion.
begin;
create extension if not exists pgtap with schema extensions;
select plan(115);

select ok(public.is_clean('Leg day, done'), 'ordinary captions pass');
select ok(not public.is_clean('what the fuuuck'), 'repeated letters don''t get around the filter');
select ok(not public.is_clean('sh1t happens'), 'nor do digits for letters');
select ok(public.is_clean('Assassin class, then a glass of water'), 'blocked words inside ordinary words are fine');

-- A number is a number, however its digits would read as letters, and so is one written with a
-- sign, like a price: digits and symbols read as letters only beside a letter, or with no digit.
select ok(public.is_clean('Read up to page 455'), 'a page number passes');
select ok(public.is_clean('Deadlift 455 lbs!'), 'so does a weight');
select ok(public.is_clean('Room #455'), 'and a number after a sign');
select ok(public.is_clean('8455 steps, 2455 calories'), 'and one with a digit that stands for no letter');
select ok(public.is_clean('Paid 45$ for the new shoes'), 'and a price with its sign after it');
select ok(public.is_clean('455$'), 'however its digits would read');
select ok(public.is_clean('Bench 5x5 @55'), 'and a weight after an at sign');
select ok(public.is_clean('4$$'), 'so digits and symbols alone pass, even where they could spell a word');
select ok(public.is_clean('4$5'), 'wherever the symbol sits among the digits');

-- Everything else reads as it always did.
select ok(not public.is_clean('a55'), 'digits next to a letter still stand for letters');
select ok(not public.is_clean('a$$'), 'and so do symbols');
select ok(not public.is_clean('4ss'), 'a digit before letters too');
select ok(not public.is_clean('5h1t'), 'and digits between them');
select ok(not public.is_clean('@$$'), 'symbols with no digit stand for letters by themselves');
select ok(not public.is_clean('8a55 shit2'), 'a digit that stands for no letter still ends a word');
select ok(not public.is_clean('sh1t 455'), 'a number next to a word doesn''t clear the word');
select ok(public.is_clean('קראתי עד עמוד 455'), 'Hebrew with a number passes');
select ok(public.is_clean('עמוד455 מתוך 800'), 'also with the number stuck to a word');
select ok(not public.is_clean('היום a55 ממש'), 'and a blocked word among Hebrew is still caught');

-- Shit and slut are blocked as words, with the longer forms the list names, since common surnames
-- begin with them.
select ok(public.is_clean('Noa Shitrit'), 'a surname that begins with a blocked word passes');
select ok(public.is_clean('Dana Slutsky, Avi Slutzky'), 'and so do others');
select ok(public.is_clean('Shiitake risotto'), 'and a word that reads as one with its doubled letter undone');
select is(
  (select array_agg(form) from unnest(array[
    'shit', 'Shit.', 'sh1t', 'shiiit', 'shits', 'shitty', 'shithead', 'shitheads', 'shitting', 'slut', 'sluts', 'slutty'
  ]) form where public.is_clean(form)),
  null,
  'the words themselves and the forms the list names are still refused'
);

-- Every word on the list that is refused as written, in every mix of letters and the digits that
-- stand for them, is blocked. The one spelling that is all digits is the number.
with recursive spelled (done, rest) as (
  select '', word from public.blocked_words where match <> 'masked'
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

-- Nor does any other spelling: in capitals, with each letter tripled, with a mark or a digit after
-- it, with an invisible character or an accent inside, and with more after it when its longer forms
-- are blocked too.
select is(
  (select array_agg(s.spelled order by s.spelled)
   from public.blocked_words w
   cross join lateral (values
     (upper(w.word)),
     (regexp_replace(w.word, '(.)', '\1\1\1', 'g')),
     ('you ' || w.word || '!'),
     (w.word || '1'),
     (left(w.word, 1) || U&'\200B' || substr(w.word, 2)),
     (left(w.word, 1) || U&'\0301' || substr(w.word, 2)),
     (w.word || case w.match when 'prefix' then 'ing' else '' end)
   ) as s (spelled)
   where w.match <> 'masked' and public.is_clean(s.spelled)),
  null,
  'no other spelling of a word on the list passes'
);
select is(
  (select array_agg(spelled) from unnest(array[
    U&'\FF26\FF35\FF23\FF2B', U&'\+01D41F\+01D42E\+01D41C\+01D424', 'fu' || U&'\0441' || 'k', 'sh' || U&'\0456' || 't pack', U&'\0430ss'
  ]) spelled where public.is_clean(spelled)),
  null,
  'fullwidth, mathematical and Cyrillic letters read as the letters they look like'
);
select is(
  (select array_agg(spelled) from unnest(array[
    'f' || U&'\00AD' || 'uck', 'f' || U&'\2060' || 'uck', U&'\FEFF' || 'fu' || U&'\200D' || 'ck', 'fu' || U&'\200F' || 'ck you'
  ]) spelled where public.is_clean(spelled)),
  null,
  'a soft hyphen, a joiner or a direction mark doesn''t split a word'
);
select is(
  (select array_agg(spelled) from unnest(array['dumbass', 'Dipshits!', 'you dumbfuck']) spelled where public.is_clean(spelled)),
  null,
  'insults that end in a blocked word are on the list'
);
select is(
  (select array_agg(spelled) from unnest(array[
    'as', 'Assaf, Hadas and Dikla', U&'Zo\00EB, Ren\00E9e and Jos\00E9', 'Leg day, done!', 'Finally!!', 'Class 2 at 7'
  ]) spelled where not public.is_clean(spelled)),
  null,
  'ordinary words and names still pass'
);

-- A star between letters stands for any letter but the first, single letters spaced out read as one
-- word, and a '!' after a word is a mark even where digits spell it. A phrase on the list is refused
-- with its words in order, apart or together.
select is(
  (select array_agg(spelled) from unnest(array[
    'f*ck', 'what the f**k', 'sh*t happens', 'a**hole', 'f u c k', 'f.u.c.k', 'F-U-C-K you', 'k y s', 's_h_i_t',
    'f * c k', 'sh1t!', 'a55!', 'f*k', 'F U K', 'fck', 'fcuk', 'fvck', 'phuck', 'cocksucker', 'kill yourself',
    'Go KILL yourself!', 'killyourself', 'k1ll y0urself!', 'k i l l y o u r s e l f'
  ]) spelled where public.is_clean(spelled)),
  null,
  'starred, spaced-out and short spellings are refused, and so is a phrase on the list'
);
select is(
  (select array_agg(s.spelled order by s.spelled)
   from public.blocked_words w
   cross join lateral (values (' '), ('.'), ('-'), ('_'), ('*')) as mark (sign)
   cross join lateral (select regexp_replace(w.word, '(.)(?!$)', '\1' || mark.sign, 'g') as spelled) s
   where w.word !~ ' ' and public.is_clean(s.spelled)),
  null,
  'no word on the list passes spaced out'
);
select is(
  (select array_agg(s.spelled order by s.spelled)
   from public.blocked_words w
   cross join lateral generate_series(2, char_length(w.word) - 1) letter
   cross join lateral (select overlay(w.word placing '*' from letter for 1) as spelled) s
   where w.word !~ ' ' and public.is_clean(s.spelled)),
  null,
  'nor with a star for a letter between its first and its last'
);
select is(
  (select array_agg(spelled) from unnest(array[
    'Fukuda and Fukuoka', 'Phuket', 'J. K. Rowling', 'U.S.A.', 'T-shirt day', 'Plan B', 'Not *as* bad as yesterday',
    'a*b', 'Kill your self-doubt', 'Upskill yourself', 'Dad''s hit song', 'Cocksfoot grass', 'Paid 45$!', '455!',
    'Wong Fuk Hing', 'Chan Fuk-wing', 'Flying to FUK tomorrow', 'Don''t kill yourself', 'Rest day, don''t kill yourself'
  ]) spelled where not public.is_clean(spelled)),
  null,
  'names, prices and words near those spellings still pass'
);

-- A word on the list as masked, like Fuk, a given name too, passes as written. Spaced out or with a
-- star for a letter it is refused, as every word on the list is above.
select is(
  (select array_agg(s.spelled order by s.spelled)
   from public.blocked_words w
   cross join lateral (values (w.word), (upper(w.word)), ('Hi ' || initcap(w.word) || '!')) as s (spelled)
   where w.match = 'masked' and not public.is_clean(s.spelled)),
  null,
  'a word refused only masked passes as written'
);

-- A phrase on the list after don't, dont, do not, never or won't says the opposite of what the list
-- refuses, so it passes there, and only there.
select is(
  (select array_agg(s.spelled order by s.spelled)
   from public.blocked_words w
   cross join lateral (values
     ('Don''t '), (U&'don\2019t '), ('dont '), ('Do not '), ('Never '), ('You won''t '), ('Rest day, don''t ')
   ) as n (said)
   cross join lateral (select n.said || w.word || '!' as spelled) s
   where w.word ~ ' ' and not public.is_clean(s.spelled)),
  null,
  'a phrase on the list passes after don''t, dont, do not, never or won''t'
);
select is(
  (select array_agg(spelled) from unnest(array[
    'Just kill yourself', 'Kill yourself, don''t', 'Don''t stop, kill yourself', 'Never mind, kill yourself',
    'Don''t kill yourself, kill yourself', 'Never. Kill yourself', 'I won''t, kill yourself', 'Do not! Kill yourself!',
    'Don''t, kill yourself, loser', 'Never. K1ll y0urself', 'Never 2 k1ll y0urself'
  ]) spelled where public.is_clean(spelled)),
  null,
  'and nowhere else'
);

-- The negation counts only with nothing but spaces before the phrase: a stop, a comma, a colon, a
-- semicolon, an exclamation or question mark or a dash between them ends what it says.
select is(
  (select array_agg(s.spelled order by s.spelled)
   from public.blocked_words w
   cross join lateral (values ('Don''t'), (U&'don\2019t'), ('dont'), ('Do not'), ('Never'), ('You won''t')) as n (said)
   cross join lateral (values ('. '), (', '), (': '), ('; '), ('! '), ('? '), (' - '), (U&' \2014 '), ('-')) as mark (sign)
   cross join lateral (select n.said || mark.sign || w.word as spelled) s
   where w.word ~ ' ' and public.is_clean(s.spelled)),
  null,
  'a mark between the negation and the phrase keeps the phrase refused'
);

-- A name that comes with a new account is kept only when it passes the filter, so a name with a
-- blocked word leaves the profile without one, and the setup asks for it.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000001a7', 'one@test.local', '{"full_name": "Fuck You"}'),
  ('00000000-0000-0000-0000-0000000001b7', 'two@test.local', '{"name": "you ass!"}'),
  ('00000000-0000-0000-0000-0000000001c7', 'three@test.local', '{"full_name": "Noa Shitrit"}'),
  ('00000000-0000-0000-0000-0000000001d7', 'four@test.local', '{"full_name": "Wong Fuk Hing"}');
select is(
  (select array_agg(display_name order by id) from public.profiles
   where id in (
     '00000000-0000-0000-0000-0000000001a7', '00000000-0000-0000-0000-0000000001b7', '00000000-0000-0000-0000-0000000001c7',
     '00000000-0000-0000-0000-0000000001d7'
   )),
  array[null, null, 'Noa Shitrit', 'Wong Fuk Hing'],
  'a new account keeps the name it came with only when the name passes the filter'
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

-- A text an update leaves as it was isn't filtered again, so a name or a habit saved before the
-- filter refused it, written here with the filter off, doesn't stop the rest of its row from saving.
-- A changed one is filtered as a new one is.
create temp table old_pack as select public.create_pack('Morning run', 'custom', 1::smallint, 'mochi', 'UTC', 'Run 5k') as id;
reset role;
set local session_replication_role = replica;
update public.packs set name = 'Get Sh*t Done', custom_habit = 'Kick ass!' where id = (select id from old_pack);
update public.profiles set display_name = 'Dumbass Runner', terms_accepted_at = now() where id = '00000000-0000-0000-0000-0000000000a7';
reset session_replication_role;
set local role authenticated;
select lives_ok(
  $$ select public.update_pack((select id from old_pack), 'Get Sh*t Done', 2::smallint, 'sunday') $$,
  'a pack name saved before the filter refused it doesn''t stop the pack''s settings from saving'
);
select is(
  (select pending_rest_days_per_week || ' ' || pending_week_start from public.packs where id = (select id from old_pack)),
  '2 sunday', 'they are saved'
);
select throws_ok(
  $$ select public.update_pack((select id from old_pack), 'F*ck Mondays', 2::smallint, 'sunday') $$,
  '22023', 'text_not_allowed', 'a new pack name is still filtered'
);
select lives_ok(
  $$ update public.profiles set display_name = 'Dumbass Runner', reminder_time = '07:30' where id = '00000000-0000-0000-0000-0000000000a7' $$,
  'nor does a display name saved before stop its profile from saving'
);
select throws_ok(
  $$ update public.profiles set display_name = 'Dipshit' where id = '00000000-0000-0000-0000-0000000000a7' $$,
  '22023', 'text_not_allowed', 'and a new display name is still filtered'
);
reset role;
select lives_ok(
  $$ update public.packs set custom_habit = 'Kick ass!', rest_days_per_week = 2 where id = (select id from old_pack) $$,
  'nor does a habit saved before stop its pack from saving'
);
select throws_ok(
  $$ update public.packs set custom_habit = 'Fck this rain' where id = (select id from old_pack) $$,
  '22023', 'text_not_allowed', 'and a new habit is still filtered'
);

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

-- The report that hides a photo emails the developer even past its reporter's 20 a day, so a hidden
-- photo always reaches the review that ends its hiding. Reports on a photo already hidden don't.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008a1', 'ido@test.local'),
  ('00000000-0000-0000-0000-0000000008b1', 'lior@test.local'),
  ('00000000-0000-0000-0000-0000000008c1', 'tal@test.local'),
  ('00000000-0000-0000-0000-0000000008d1', 'yael@test.local');
insert into public.pack_members (pack_id, user_id)
select id, u from pack, unnest(array[
  '00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-0000000008b1',
  '00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000008d1'
]::uuid[]) u;
create temp table pile (id uuid, n bigint);
with posted as (
  insert into public.feeds (pack_id, user_id, day, is_extra)
  select (select id from pack), '00000000-0000-0000-0000-0000000000b7', current_date, true from generate_series(1, 64)
  returning id
)
insert into pile select id, row_number() over (order by id) from posted;
grant select on pile to authenticated;
create function pg_temp.mailed_about(feed uuid) returns uuid[] language sql as $$
  select array_agg(r.reporter_id order by r.reporter_id) from pg_temp.mailed() m join public.reports r on r.id = m where r.feed_id = feed;
$$;
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008a1' from pile where n <= 21;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008b1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008b1' from pile where n between 22 and 42;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008c1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008c1' from pile where n between 43 and 63;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008d1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008d1' from pile where n <= 21;
reset role;
select is(
  (select count(*) from pg_temp.mailed() m join public.reports r on r.id = m where r.reporter_id::text like '00000000-0000-0000-0000-0000000008_1'),
  0::bigint, 'a bulk of 21 reports emails none of them'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008a1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008a1' from pile where n = 64;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008b1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008b1' from pile where n = 64;
reset role;
select is(pg_temp.mailed_about((select id from pile where n = 64)), null, 'two reports past the cap on a photo email nothing');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008c1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008c1' from pile where n = 64;
reset role;
select ok((select hidden_at is not null from public.feeds where id = (select id from pile where n = 64)), 'a third past the cap hides the photo');
select is(
  pg_temp.mailed_about((select id from pile where n = 64)), array['00000000-0000-0000-0000-0000000008c1'::uuid],
  'and emails the developer'
);
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000008d1');
insert into public.reports (feed_id, reporter_id) select id, '00000000-0000-0000-0000-0000000008d1' from pile where n = 64;
reset role;
select is(
  pg_temp.mailed_about((select id from pile where n = 64)), array['00000000-0000-0000-0000-0000000008c1'::uuid],
  'a fourth past the cap, on the photo already hidden, emails nothing'
);

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
