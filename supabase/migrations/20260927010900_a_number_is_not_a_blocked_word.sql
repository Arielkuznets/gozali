-- Digits stand in for letters only next to a letter or a symbol: a run of digits alone is a number,
-- whatever it would spell. So the text is cut at what can't be part of a word in any spelling first,
-- and the digits that stand for no letter end a word only after that.
create or replace function public.is_clean(input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from regexp_split_to_table(lower(coalesce(input, '')), '[^a-z0-9@$!֐-׿]+') chunk
    cross join lateral regexp_split_to_table(translate(chunk, '013457@$!', 'oieastasi'), '[^a-z֐-׿]+') token
    cross join lateral (values (token), (regexp_replace(token, '(.)\1+', '\1', 'g'))) as form (word)
    join public.blocked_words w
      on (w.match = 'word' and form.word = w.word) or (w.match = 'prefix' and form.word like w.word || '%')
    where chunk !~ '^[0-9]+$' and token <> ''
  );
$$;
