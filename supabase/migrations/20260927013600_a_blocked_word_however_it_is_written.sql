-- The text is read as written and folded: invisible characters and the marks on a letter taken out
-- (Hebrew points stay), fullwidth and styled letters made plain, and Cyrillic letters drawn like
-- Latin ones read as those. Each reading is cut into words twice: with digits and symbols as the
-- letters they stand for, skipping a number, and on letters alone, so a mark after a word ('ass!')
-- doesn't join it. A word on the list matches with each of its letters written once or more, so
-- 'asss' is 'ass' and 'shiitake' isn't 'shit'. Each reading only adds words, so a text refused as
-- written is still refused.
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
  tokens as (
    select token
    from readings r
    cross join lateral regexp_split_to_table(r.text, '[^a-z0-9@$!֐-׿]+') chunk
    cross join lateral regexp_split_to_table(translate(chunk, '013457@$!', 'oieastasi'), '[^a-z֐-׿]+') token
    where chunk !~ '^[0-9]+$'
    union
    select regexp_split_to_table(r.text, '[^a-z֐-׿]+') from readings r
  ),
  list as (
    select
      '^(' || string_agg(regexp_replace(w.word, '(.)', '\1+', 'g'), '|') filter (where w.match = 'word') || ')$' as words,
      '^(' || string_agg(regexp_replace(w.word, '(.)', '\1+', 'g'), '|') filter (where w.match = 'prefix') || ')' as prefixes
    from public.blocked_words w
  )
  select not exists (
    select 1 from tokens, list
    where tokens.token <> '' and (tokens.token ~ list.words or tokens.token ~ list.prefixes)
  );
$$;

-- Insults that end in a blocked word.
insert into public.blocked_words (word, match) values ('dumbass', 'prefix'), ('dipshit', 'prefix'), ('dumbfuck', 'prefix')
on conflict (word) do nothing;
