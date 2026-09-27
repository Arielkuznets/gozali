-- Store requirements for user-generated content (spec section 11): filtering offensive words,
-- reports that alert the developer and hide an item that several members reported, and the
-- data needed to delete an account.

-- Words that may not appear in captions or names. 'word' matches a whole word, 'prefix' also
-- its longer forms. The list is data: it grows in the database without a release.
create table public.blocked_words (
  word text primary key check (word = lower(word) and word ~ '^[a-z\u0590-\u05ff]+$'),
  match text not null default 'word' check (match in ('word', 'prefix'))
);
alter table public.blocked_words enable row level security;
revoke all on public.blocked_words from anon, authenticated;

insert into public.blocked_words (word, match) values
  ('fuck', 'prefix'), ('motherfuck', 'prefix'), ('shit', 'prefix'), ('bullshit', 'prefix'), ('cunt', 'prefix'),
  ('bitch', 'prefix'), ('asshole', 'prefix'), ('dickhead', 'prefix'), ('bastard', 'prefix'), ('wanker', 'prefix'),
  ('whore', 'prefix'), ('slut', 'prefix'), ('retard', 'prefix'), ('faggot', 'prefix'), ('nigger', 'prefix'),
  ('nigga', 'prefix'), ('ass', 'word'), ('dick', 'word'), ('dicks', 'word'), ('cock', 'word'), ('cocks', 'word'),
  ('pussy', 'word'), ('twat', 'word'), ('fag', 'word'), ('fags', 'word'), ('kys', 'word');

-- True when no blocked word appears. Common digit and symbol swaps (sh1t, @ss) are undone first,
-- and each word is also checked with repeated letters collapsed (fuuuck).
create function public.is_clean(input text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from regexp_split_to_table(translate(lower(coalesce(input, '')), '013457@$!', 'oieastasi'), '[^a-z\u0590-\u05ff]+') token
    cross join lateral (values (token), (regexp_replace(token, '(.)\1+', '\1', 'g'))) as form (word)
    join public.blocked_words w
      on (w.match = 'word' and form.word = w.word) or (w.match = 'prefix' and form.word like w.word || '%')
    where token <> ''
  );
$$;
revoke execute on function public.is_clean(text) from public, anon, authenticated;

-- One trigger function for every text column members write: the column name is the argument.
-- It runs as its owner, because members write some of these columns directly (their profile).
create function public.reject_blocked_words()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_clean(to_jsonb(new) ->> tg_argv[0]) then
    raise exception 'text_not_allowed' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function public.reject_blocked_words() from public, anon, authenticated;

create trigger clean_caption before insert or update of caption on public.feeds
  for each row execute function public.reject_blocked_words('caption');
create trigger clean_pack_name before insert or update of name on public.packs
  for each row execute function public.reject_blocked_words('name');
create trigger clean_critter_name before update of name on public.critters
  for each row execute function public.reject_blocked_words('name');
create trigger clean_name_suggestion before insert on public.name_suggestions
  for each row execute function public.reject_blocked_words('name');
create trigger clean_habit before insert or update of custom_habit on public.packs
  for each row execute function public.reject_blocked_words('custom_habit');
-- Profiles are checked when the member edits them; a name from Apple or Google at sign-up
-- is only a suggestion the member confirms in profile setup.
create trigger clean_display_name before update of display_name on public.profiles
  for each row execute function public.reject_blocked_words('display_name');

-- Several members reporting the same item hides it until the developer looks (the 24-hour
-- handling in spec section 11 is the developer's; this keeps a pile-on from waiting for it).
-- Every report also alerts the developer through the on-report function.
create function public.call_edge_function(name text, body jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text := (select decrypted_secret from vault.decrypted_secrets where vault.decrypted_secrets.name = 'functions_url');
  secret text := (select decrypted_secret from vault.decrypted_secrets where vault.decrypted_secrets.name = 'cron_secret');
begin
  if base_url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := base_url || '/' || name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := body,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

create function public.handle_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.reports r where r.feed_id = new.feed_id) >= 3 then
    update public.feeds set hidden_at = now() where id = new.feed_id and hidden_at is null;
  end if;
  perform public.call_edge_function('on-report', jsonb_build_object('reportId', new.id));
  return new;
end;
$$;
revoke execute on function public.handle_report() from public, anon, authenticated;
create trigger report_alert after insert on public.reports
  for each row execute function public.handle_report();

-- What the on-report email needs.
create function public.report_details(report uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reportId', r.id,
    'reason', r.reason,
    'reportedAt', r.created_at,
    'reporter', jsonb_build_object('id', reporter.id, 'name', reporter.display_name),
    'feed', jsonb_build_object(
      'id', f.id, 'caption', f.caption, 'photoPath', f.photo_path, 'hidden', f.hidden_at is not null,
      'postedAt', f.created_at, 'packId', f.pack_id
    ),
    'author', jsonb_build_object('id', author.id, 'name', author.display_name),
    'reports', (select count(*) from public.reports x where x.feed_id = f.id)
  )
  from public.reports r
  join public.feeds f on f.id = r.feed_id
  join public.profiles reporter on reporter.id = r.reporter_id
  join public.profiles author on author.id = f.user_id
  where r.id = report;
$$;

-- Account deletion (spec section 11) runs in the delete-account function: it leaves every pack
-- as the member (so admin passes on), removes the photo files, deletes the auth user (profiles,
-- memberships, feeds, reactions and tokens go with it) and drops packs nobody is left in.
create function public.account_photo_paths(member uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'feed-photos' and (storage.foldername(o.name))[2] = member::text;
$$;

create function public.drop_empty_packs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  dropped integer;
begin
  delete from public.packs p
  where not exists (select 1 from public.pack_members m where m.pack_id = p.id and m.status <> 'left');
  get diagnostics dropped = row_count;
  return dropped;
end;
$$;

revoke execute on function public.report_details(uuid) from public, anon, authenticated;
revoke execute on function public.account_photo_paths(uuid) from public, anon, authenticated;
revoke execute on function public.drop_empty_packs() from public, anon, authenticated;
grant execute on function public.report_details(uuid) to service_role;
grant execute on function public.account_photo_paths(uuid) to service_role;
grant execute on function public.drop_empty_packs() to service_role;
