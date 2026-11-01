-- The time the terms were accepted is the server's. The app sends the phone's clock, which can be
-- days off, and the first value stays for good, so such a sign-up kept a wrong consent time and
-- counted on the wrong day of the owners' summary. Any value now only says that the terms were
-- accepted, which is what every build already sends. Times already stored stay: nothing says
-- which of them were wrong.
create or replace function public.keep_terms_accepted()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.terms_accepted_at := coalesce(old.terms_accepted_at, case when new.terms_accepted_at is not null then now() end);
  return new;
end;
$$;
revoke execute on function public.keep_terms_accepted() from public, anon, authenticated;
