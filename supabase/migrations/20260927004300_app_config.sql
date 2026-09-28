-- Settings the app reads when it starts (pre-release audit, 2026-09-28), in one row:
--   min_version: an installed app older than this shows "time to update" instead of the app, for
--     the day a server change would break old versions still on people's phones;
--   ios_url, android_url: the store pages that screen opens;
--   apple_revocation: deleting an account asks Apple for a fresh code, so the server can revoke
--     the user's Sign in with Apple tokens. Turn it on once the Apple key is in the function
--     secrets (docs/setup.md).
-- Changed by hand, for example:
--   update public.app_config set min_version = '1.1.0';
create table public.app_config (
  id boolean primary key default true check (id),
  min_version text not null default '0.0.0' check (min_version ~ '^\d+\.\d+\.\d+$'),
  ios_url text,
  android_url text,
  apple_revocation boolean not null default false
);
insert into public.app_config default values;
alter table public.app_config enable row level security;
create policy "app_config: everyone reads" on public.app_config for select to anon, authenticated using (true);
revoke insert, update, delete on public.app_config from anon, authenticated;
