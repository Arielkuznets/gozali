-- A number written with a sign, like a price ('Paid 45$') or a weight ('bench @55'), is a number
-- too: digits and symbols read as the letters they stand for only in a chunk with a letter in it, or
-- in one with no digit ('@$$'). So digits and symbols alone pass even where they could spell a
-- word, as '4$$' does: that is what telling them from a price costs.
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
    where chunk ~ '[a-z֐-׿]' or chunk !~ '[0-9]'
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
