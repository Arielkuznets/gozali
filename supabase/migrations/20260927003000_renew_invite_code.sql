-- When an invite link reaches someone it shouldn't have, the admin replaces the pack's code: the
-- old code and link stop working at once, and the new one is shared as before.
create function public.renew_invite_code(target uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh text;
begin
  perform public.require_admin(target);
  update public.packs set invite_code = public.new_invite_code() where id = target
  returning invite_code into fresh;
  return fresh;
end;
$$;
revoke execute on function public.renew_invite_code(uuid) from public, anon;
grant execute on function public.renew_invite_code(uuid) to authenticated;
