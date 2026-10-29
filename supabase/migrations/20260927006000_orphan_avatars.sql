-- Avatar files of accounts that are gone are cleaned up too (2026-10-29). Deleting an account in the
-- app removes its avatars, but an account deleted from the Auth dashboard (what the report email
-- says to do with a member who has to go) left them in the avatars bucket. A day's grace is only a
-- margin: an avatar can't be written before its profile exists.
create function public.orphan_avatars(at_time timestamptz default now(), max_rows integer default 500)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'avatars'
    and o.created_at < at_time - interval '1 day'
    and not exists (select 1 from public.profiles p where p.id::text = (storage.foldername(o.name))[1])
  order by o.created_at
  limit max_rows;
$$;
revoke execute on function public.orphan_avatars(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.orphan_avatars(timestamptz, integer) to service_role;
