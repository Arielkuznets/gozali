-- A request without a session reads app_config or calls report_sign_in_problem or
-- forget_push_token, each a few milliseconds. A regex filter with backreferences on a store link
-- runs until the role's time limit instead, and about fourteen of them at once hold every
-- connection of the API, so everyone's reads wait. Half a second limits what each one costs. The
-- API takes the limit from the role's settings, and reads them again only on a config reload.
alter role anon set statement_timeout = '500ms';
notify pgrst, 'reload config';
