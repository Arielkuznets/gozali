-- A word on the list can be 'masked', for a word that as written is also a name: it is refused, as
-- a whole word, only with a star for a letter ('f*k') or with its letters spaced out ('f u k'). Fuk
-- is a common given name in Hong Kong ('Wong Fuk Hing'). A phrase on the list after don't, dont, do
-- not, never or won't says the opposite of what the list refuses ("Don't kill yourself"), so it
-- passes there and is refused everywhere else.
alter table public.blocked_words
  drop constraint blocked_words_match_check,
  add constraint blocked_words_match_check
    check (match in ('word', 'prefix') or match = 'masked' and word !~ ' ');

create or replace function public.is_clean(input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with readings as (
    select lower(coalesce(input, '')) as text
    union
    select translate(
      regexp_replace(
        lower(normalize(coalesce(input, ''), nfkd)),
        '[­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\U000e0000-\U000e007f\U000e0100-\U000e01ef̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]',
        '', 'g'),
      U&'\0430\0441\0435\0456\043e\0440\0445\0443\0455\04bb\0458\0501', 'aceiopxyshjd')
  ),
  chunks as (
    select r.text as reading, c.chunk, c.n
    from readings r
    cross join lateral regexp_split_to_table(r.text, '[^a-z0-9@$!֐-׿]+') with ordinality c (chunk, n)
    where c.chunk ~ '[a-z֐-׿]' or c.chunk !~ '[0-9]'
  ),
  tokens as (
    select regexp_split_to_table(translate(f.form, '013457@$!', 'oieastasi'), '[^a-z֐-׿]+') as token, false as masked
    from chunks c
    cross join lateral (values (c.chunk), (rtrim(c.chunk, '!'))) f (form)
    union
    select regexp_split_to_table(r.text, '[^a-z֐-׿]+'), false from readings r
    union
    select m[1], true from readings r cross join lateral regexp_matches(r.text, '([a-z]+(?:\*+[a-z]+)+)', 'g') m
    union
    select regexp_replace(m[1], '[ ._*-]+', '', 'g'), true
    from readings r
    cross join lateral regexp_matches(r.text, '(?<![a-z])([a-z](?:[ ._*-]+[a-z])+)(?![a-z])', 'g') m
  ),
  -- Each reading's words in order, for the phrases.
  lines as (
    select regexp_replace(r.text, '[^a-z֐-׿]+', ' ', 'g') as line from readings r
    union
    select regexp_replace(
      string_agg(translate(rtrim(chunk, '!'), '013457@$!', 'oieastasi'), ' ' order by n),
      '[^a-z֐-׿]+', ' ', 'g')
    from chunks
    group by reading
  ),
  list as (
    select
      '^(' || string_agg(w.pattern, '|') filter (where w.match = 'word' and not w.phrase) || ')$' as words,
      '^(' || string_agg(w.pattern, '|') filter (where w.match = 'prefix' and not w.phrase) || ')' as prefixes,
      '^(' || string_agg(w.pattern, '|') filter (where w.match = 'masked') || ')$' as masked,
      '(?<!(^| )(don t|dont|do not|never|won t))(^| )('
        || string_agg(w.pattern || case w.match when 'word' then '( |$)' else '' end, '|') filter (where w.phrase)
        || ')' as phrases
    from (
      select
        b.match,
        b.word ~ ' ' as phrase,
        case when b.word ~ ' '
          then replace(regexp_replace(b.word, '([^ ])', '\1+', 'g'), ' ', ' ?')
          else left(b.word, 1) || '+' || regexp_replace(substr(b.word, 2), '(.)', '[\1*]+', 'g')
        end as pattern
      from public.blocked_words b
    ) w
  )
  select not exists (
    select 1 from tokens, list
    where tokens.token <> ''
      and (tokens.token ~ list.words or tokens.token ~ list.prefixes or tokens.token ~ list.phrases
        or tokens.masked and tokens.token ~ list.masked)
  ) and not exists (
    select 1 from lines, list where lines.line ~ list.phrases
  );
$$;

update public.blocked_words set match = 'masked' where word = 'fuk';
