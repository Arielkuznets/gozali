-- Widgets (spec section 9). A widget runs outside the app and can't hold the user's session,
-- so each device gets a widget token that can only read the packs' state. The server keeps only
-- its hash (spec section 13), and the token dies on sign-out.

create function public.create_widget_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := public.require_user();
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.widget_tokens (user_id, token_hash)
  values (caller, encode(extensions.digest(token, 'sha256'), 'hex'));
  return token;
end;
$$;

create function public.revoke_widget_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.widget_tokens
  where user_id = (select auth.uid()) and token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
$$;

-- The state a widget shows, for the owner of a token: per pack the critter and numbers only,
-- never photos or names of members (spec section 9). Null for an unknown token.
create function public.widget_state(token text, at_time timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  update public.widget_tokens set last_used_at = at_time
  where token_hash = encode(extensions.digest(token, 'sha256'), 'hex')
  returning user_id into owner;
  if owner is null then
    return null;
  end if;

  return jsonb_build_object(
    'timezone', (select pr.timezone from public.profiles pr where pr.id = owner),
    'packs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'category', p.category,
        'dayEndsAt', public.day_closes_at(p.timezone, today.day) - interval '60 minutes',
        'daysRunning', public.pack_first_day(p.id) is not null,
        'critter', jsonb_build_object(
          'name', c.name, 'species', c.species, 'color', c.color, 'health', c.health, 'stage', c.stage,
          'status', c.status, 'streak', c.streak, 'marks', to_jsonb(c.marks), 'outfit', c.outfit
        ),
        'iFed', public.fed_on(p.id, owner, today.day),
        -- One entry per member, oldest first, without names.
        'members', (
          select jsonb_agg(
            case
              when public.fed_on(p.id, m.user_id, today.day) then 'fed'
              when m.status = 'sleeping' or exists (
                select 1 from public.pauses s where s.pack_id = p.id and s.user_id = m.user_id and today.day between s.starts_on and s.ends_on
              ) then 'away'
              when exists (
                select 1 from public.day_passes d where d.pack_id = p.id and d.user_id = m.user_id and d.day = today.day
              ) then 'pass'
              else 'waiting'
            end
            order by m.joined_at)
          from public.pack_members m
          where m.pack_id = p.id and m.status <> 'left'
        )
      ) order by p.created_at)
      from public.pack_members mine
      join public.packs p on p.id = mine.pack_id
      join public.critters c on c.pack_id = p.id
      cross join lateral (select public.pack_day(p.timezone, at_time) as day) today
      where mine.user_id = owner and mine.status <> 'left'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.create_widget_token() from public, anon;
revoke execute on function public.revoke_widget_token(text) from public, anon;
revoke execute on function public.widget_state(text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_widget_token() to authenticated;
grant execute on function public.revoke_widget_token(text) to authenticated;
grant execute on function public.widget_state(text, timestamptz) to service_role;
