-- Shitrit, Slutsky and Slutzky are common surnames, so shit and slut are blocked as whole words, and
-- the longer forms that are insults are on the list themselves. Sluts stays a word, since Slutsky
-- begins with it.
update public.blocked_words set match = 'word' where word in ('shit', 'slut');
insert into public.blocked_words (word, match) values
  ('shits', 'word'), ('shitty', 'prefix'), ('shithead', 'prefix'), ('shithole', 'prefix'), ('shitting', 'prefix'),
  ('sluts', 'word'), ('slutty', 'prefix')
on conflict (word) do nothing;
