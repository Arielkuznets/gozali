-- A star between letters stands for a letter ('f*ck', 'a**hole'), single letters spaced out with
-- spaces, dots, dashes, underscores or stars read as one word ('f u c k', 'k.y.s'), and a '!' after
-- a word spelled with digits is the mark it usually is ('sh1t!'). A star before or after a word
-- stays a mark, so '*as*' passes. The list can hold a phrase, refused with its words in order,
-- apart or written together ('kill yourself'). Each reading only adds words, so a text refused
-- before is still refused.
alter table public.blocked_words
  drop constraint blocked_words_word_check,
  add constraint blocked_words_word_check
    check (word = lower(word) and word ~ '^[a-z֐-׿]+( [a-z֐-׿]+)*$');

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
    select regexp_split_to_table(translate(f.form, '013457@$!', 'oieastasi'), '[^a-z֐-׿]+') as token
    from chunks c
    cross join lateral (values (c.chunk), (rtrim(c.chunk, '!'))) f (form)
    union
    select regexp_split_to_table(r.text, '[^a-z֐-׿]+') from readings r
    union
    select m[1] from readings r cross join lateral regexp_matches(r.text, '([a-z]+(?:\*+[a-z]+)+)', 'g') m
    union
    select regexp_replace(m[1], '[ ._*-]+', '', 'g')
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
      '(^| )(' || string_agg(w.pattern || case w.match when 'word' then '( |$)' else '' end, '|')
        filter (where w.phrase) || ')' as phrases
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
      and (tokens.token ~ list.words or tokens.token ~ list.prefixes or tokens.token ~ list.phrases)
  ) and not exists (
    select 1 from lines, list where lines.line ~ list.phrases
  );
$$;

-- Short spellings of fuck that begin no ordinary word, cocksucker, and a phrase. Fuk is refused
-- only as a whole word: names like Fukuda begin with it.
insert into public.blocked_words (word, match) values
  ('fuk', 'word'), ('fck', 'prefix'), ('fcuk', 'prefix'), ('fvck', 'prefix'), ('phuck', 'prefix'),
  ('cocksuck', 'prefix'), ('kill yourself', 'word')
on conflict (word) do nothing;
