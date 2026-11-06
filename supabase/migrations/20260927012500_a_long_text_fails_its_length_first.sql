-- The word filter costs time by the word, and as a trigger it runs before the column's check on
-- length, so a text of megabytes held a connection for seconds before that check refused it. Every
-- column filtered holds 80 characters at most (caption 80, habit 40, pack and display name 30,
-- critter and suggested name 20), so a text over 200 is left to its check, which refuses it.
create or replace function public.reject_blocked_words()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  value text := to_jsonb(new) ->> tg_argv[0];
begin
  if char_length(value) > 200 then
    return new;
  end if;
  if not public.is_clean(value) then
    raise exception 'text_not_allowed' using errcode = '22023';
  end if;
  return new;
end;
$$;
