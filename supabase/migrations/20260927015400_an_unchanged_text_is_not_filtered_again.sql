-- A text an update leaves as it was isn't filtered again. It was filtered when it was written, and
-- the list and the filter grow, so a name or a habit they refuse now would otherwise stop every later
-- save of its row: update_pack writes the pack's name back with every change of rest days or week
-- start. A changed text is filtered as a new one is, and an insert always is.
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
  if tg_op = 'UPDATE' and value is not distinct from to_jsonb(old) ->> tg_argv[0] then
    return new;
  end if;
  if not public.is_clean(value) then
    raise exception 'text_not_allowed' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- A name that came with an account before sign-up names were filtered (20260927013700) was never
-- filtered when it was written: the profile setup, which sends it back, filtered it there. On a
-- profile not yet set up, such a name the filter refuses is left out, as one is at sign-up now, so
-- the setup asks for a name.
update public.profiles
set display_name = null
where terms_accepted_at is null and display_name is not null and not public.is_clean(display_name);
