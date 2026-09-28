-- The terms are accepted once. A profile could clear terms_accepted_at and set it again, and
-- every time the owners got another sign-up alert (found in the pre-release audit, 2026-09-28).
-- Now the first acceptance stays: clearing it or setting it again changes nothing.
create function public.keep_terms_accepted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.terms_accepted_at := coalesce(old.terms_accepted_at, new.terms_accepted_at);
  return new;
end;
$$;

create trigger keep_terms_accepted
  before update of terms_accepted_at on public.profiles
  for each row execute function public.keep_terms_accepted();
