-- apple_web_sign_in: on iPhones (and iPads), once Apple's native sign-in sheet fails or is closed,
-- the welcome screen also offers Sign in with Apple in the browser. That flow needs a Services ID
-- and its key in the Apple provider of the auth settings (docs/setup.md, section 8), so it starts
-- off and is turned on by hand once they are there:
--   update public.app_config set apple_web_sign_in = true;
alter table public.app_config add column apple_web_sign_in boolean not null default false;
