-- Notifications for the people who run Gozali (owner's request, 2026-09-28): one when someone
-- finishes signing up, and a summary of the day at 21:00. The next migration uses them; a new
-- enum value can only be used once the migration that adds it has committed.
alter type public.notification_type add value 'new_user';
alter type public.notification_type add value 'daily_summary';
