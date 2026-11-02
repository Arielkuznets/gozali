-- A member's photo path goes to everyone in their packs with every pack they load, and the jobs
-- that send pushes read the rest of these, so they have a size. The app writes a path of 54
-- characters, a language code, and true or false for each kind of notification, all far below it.
-- Only a crafted request can go past it, so such a row goes back to the column's default here
-- instead of stopping the migration.
update public.profiles set avatar_path = null where char_length(avatar_path) > 200;
update public.profiles set locale = 'en' where char_length(locale) > 35;
update public.profiles set notification_prefs = '{}' where pg_column_size(notification_prefs) > 4096;

alter table public.profiles
  add constraint avatar_path_length check (char_length(avatar_path) <= 200),
  add constraint locale_length check (char_length(locale) <= 35),
  add constraint prefs_size check (pg_column_size(notification_prefs) <= 4096);
