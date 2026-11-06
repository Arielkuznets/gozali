-- A negation lets a phrase on the list through only with nothing but spaces between them ("Don't
-- kill yourself"). Anything else between them, a stop, a comma, a colon, a dash, a number or any
-- other mark, ends what the negation says ("Never. Kill yourself", "I won't, kill yourself"), so
-- the phrase after it is refused. The lines the phrases are read in keep a gap of spaces as one
-- space and turn any other gap into '|': a phrase can begin or end at either, but a negation counts
-- only with a space after it. The apostrophe of don't and won't stays part of the word, whatever
-- mark it is written with.
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
    select r.text as reading, c.chunk, c.n, c.chunk ~ '[a-z֐-׿]' or c.chunk !~ '[0-9]' as word
    from readings r
    cross join lateral regexp_split_to_table(r.text, '[^a-z0-9@$!֐-׿]+') with ordinality c (chunk, n)
  ),
  -- Gap n is the one after chunk n.
  gaps as (
    select r.text as reading, g.gap[1] as gap, g.n
    from readings r
    cross join lateral regexp_matches(r.text, '[^a-z0-9@$!֐-׿]+', 'g') with ordinality g (gap, n)
  ),
  tokens as (
    select regexp_split_to_table(translate(f.form, '013457@$!', 'oieastasi'), '[^a-z֐-׿]+') as token, false as masked
    from chunks c
    cross join lateral (values (c.chunk), (rtrim(c.chunk, '!'))) f (form)
    where c.word
    union
    select regexp_split_to_table(r.text, '[^a-z֐-׿]+'), false from readings r
    union
    select m[1], true from readings r cross join lateral regexp_matches(r.text, '([a-z]+(?:\*+[a-z]+)+)', 'g') m
    union
    select regexp_replace(m[1], '[ ._*-]+', '', 'g'), true
    from readings r
    cross join lateral regexp_matches(r.text, '(?<![a-z])([a-z](?:[ ._*-]+[a-z])+)(?![a-z])', 'g') m
  ),
  -- Each reading's words in order, for the phrases: as written, and with digits and signs read as
  -- letters in words, where a '!' after a word stays a mark. A gap of spaces reads as one space and
  -- any other gap as '|'.
  lines as (
    select regexp_replace(regexp_replace(l.text, '[^a-z֐-׿]*[^a-z֐-׿ ][^a-z֐-׿]*', '|', 'g'), ' +', ' ', 'g') as line
    from (
      select r.text from readings r
      union
      select string_agg(
        case when c.word
          then translate(rtrim(c.chunk, '!'), '013457@$!', 'oieastasi') || case when c.chunk like '%!' then '!' else '' end
          else c.chunk
        end || coalesce(g.gap, ''),
        '' order by c.n)
      from chunks c
      left join gaps g using (reading, n)
      group by c.reading
    ) l (text)
  ),
  list as (
    select
      '^(' || string_agg(w.pattern, '|') filter (where w.match = 'word' and not w.phrase) || ')$' as words,
      '^(' || string_agg(w.pattern, '|') filter (where w.match = 'prefix' and not w.phrase) || ')' as prefixes,
      '^(' || string_agg(w.pattern, '|') filter (where w.match = 'masked') || ')$' as masked,
      '(^|[ |])(?<!(^|[ |])(don[ |]t|dont|do not|never|won[ |]t) )('
        || string_agg(w.pattern || case w.match when 'word' then '([ |]|$)' else '' end, '|') filter (where w.phrase)
        || ')' as phrases
    from (
      select
        b.match,
        b.word ~ ' ' as phrase,
        case when b.word ~ ' '
          then replace(regexp_replace(b.word, '([^ ])', '\1+', 'g'), ' ', '[ |]?')
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
