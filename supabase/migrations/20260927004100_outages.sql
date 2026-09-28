-- When the service is down (an outage, or the free plan pausing the project), nobody can feed, and
-- the missed days used to close as failed days for every pack once it came back (pre-release
-- audit, 2026-09-28). Now close-days leaves a heartbeat on every run; a gap of more than an hour
-- is recorded as an outage, and a pack day that overlaps an outage by an hour or more can't fail
-- (the engine's outage rule). Outages can also be added by hand for trouble the heartbeat can't
-- see, like sign-in or storage failing while the functions run:
--   insert into public.outages (starts_at, ends_at, note) values ('...', '...', 'storage down');

create table public.outages (
  id bigint generated always as identity primary key,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  note text
);
alter table public.outages enable row level security;
revoke all on public.outages from anon, authenticated;

create table public.heartbeats (
  job text primary key,
  at timestamptz not null
);
alter table public.heartbeats enable row level security;
revoke all on public.heartbeats from anon, authenticated;

-- Called by a job at the start of each run; returns true when the gap since its last run was
-- long enough to count as an outage.
create function public.note_heartbeat(job_name text, at_time timestamptz default now())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  last timestamptz;
begin
  select h.at into last from public.heartbeats h where h.job = job_name for update;
  insert into public.heartbeats (job, at) values (job_name, at_time)
  on conflict (job) do update set at = excluded.at;
  if last is not null and at_time - last > interval '1 hour' then
    insert into public.outages (starts_at, ends_at, note) values (last, at_time, job_name || ' did not run');
    return true;
  end if;
  return false;
end;
$$;

-- Whether an outage covered at least an hour of the pack's day (03:00 to 03:00 on its clock).
create function public.outage_on(target uuid, pack_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.packs p
    cross join lateral (
      select
        (pack_date::timestamp + interval '3 hours') at time zone p.timezone as starts,
        (pack_date::timestamp + interval '1 day 3 hours') at time zone p.timezone as ends
    ) d
    join public.outages o on o.starts_at < d.ends and o.ends_at > d.starts
    where p.id = target
      and least(o.ends_at, d.ends) - greatest(o.starts_at, d.starts) >= interval '1 hour'
  );
$$;

revoke execute on function public.note_heartbeat(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.outage_on(uuid, date) from public, anon, authenticated;
grant execute on function public.note_heartbeat(text, timestamptz) to service_role;
grant execute on function public.outage_on(uuid, date) to service_role;
