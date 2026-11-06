-- The name that comes with a new account, from Apple, Google or the sign-up request itself, is kept
-- only when it passes the word filter. The filter can't refuse it here without refusing the sign-up,
-- and a later update that leaves the name alone isn't filtered, so a name with a blocked word is left
-- out and the profile setup asks for one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suggested text := nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 30), '');
begin
  insert into public.profiles (id, display_name)
  values (new.id, case when public.is_clean(suggested) then suggested end);
  return new;
end;
$$;
