-- Core schema from the product spec, section 13.
-- Game state (health, XP, stage, day results) is written only by server-side functions;
-- the app reads through row level security, set up in the next migration.

create extension if not exists btree_gist with schema extensions;

create type public.habit_category as enum ('gym', 'study', 'reading', 'running', 'water', 'custom');
create type public.week_start as enum ('sunday', 'monday');
create type public.critter_species as enum ('blob', 'spark', 'mossy');
create type public.critter_color as enum ('peach', 'butter', 'sage', 'sky', 'blush', 'sand');
create type public.critter_stage as enum ('egg', 'baby', 'kid', 'teen', 'adult', 'legend');
create type public.critter_status as enum ('egg', 'active', 'ran_away');
create type public.member_role as enum ('admin', 'member');
create type public.member_status as enum ('active', 'sleeping', 'left');
create type public.day_pass_kind as enum ('joker', 'rest');
create type public.day_type as enum ('success', 'neutral', 'fail');
create type public.reaction_emoji as enum ('fire', 'muscle', 'laugh', 'clap', 'suspicious');
create type public.achievement_key as enum (
  'hatched', 'streak_7', 'streak_14', 'streak_30', 'full_house', 'early_birds',
  'night_owls', 'comeback', 'century', 'full_pack', 'grown_up', 'legend'
);
create type public.notification_type as enum (
  'friend_fed', 'evening_reminder', 'last_one', 'nudge', 'pet_state', 'evolution', 'still_in', 'weekly_recap'
);
create type public.notification_status as enum ('pending', 'sent', 'dropped');
create type public.push_platform as enum ('ios', 'android');

-- One row per account, created by a trigger when the auth user is created.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 30),
  avatar_path text,
  timezone text not null default 'UTC',
  locale text not null default 'en',
  reminder_time time not null default '20:00',
  notification_prefs jsonb not null default '{}'::jsonb,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.packs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  category public.habit_category not null,
  custom_habit text check (char_length(custom_habit) between 1 and 40),
  rest_days_per_week smallint not null check (rest_days_per_week between 0 and 4),
  week_start public.week_start not null default 'sunday',
  timezone text not null,
  -- Eight characters without look-alikes (no I, O, 0 or 1), so codes survive being read aloud.
  invite_code text not null unique check (invite_code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default now(),
  constraint custom_habit_only_for_custom check ((category = 'custom') = (custom_habit is not null))
);

-- Exactly one critter per pack, so the pack id is the key.
create table public.critters (
  pack_id uuid primary key references public.packs (id) on delete cascade,
  species public.critter_species not null,
  name text check (char_length(name) between 1 and 20),
  color public.critter_color not null,
  health smallint not null default 70 check (health between 0 and 100),
  xp integer not null default 0 check (xp >= 0),
  stage public.critter_stage not null default 'egg',
  status public.critter_status not null default 'egg',
  streak integer not null default 0 check (streak >= 0),
  marks text[] not null default '{}' check (marks <@ array['medal', 'bandage']),
  outfit jsonb not null default '{}'::jsonb,
  hatched_at timestamptz
);

create table public.pack_members (
  pack_id uuid not null references public.packs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  status public.member_status not null default 'active',
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (pack_id, user_id),
  constraint left_at_matches_status check ((status = 'left') = (left_at is not null))
);
create index pack_members_user on public.pack_members (user_id);
-- The admin role lives only here (no packs.admin_id), and a pack has exactly one admin.
create unique index one_admin_per_pack on public.pack_members (pack_id) where role = 'admin';

create table public.pauses (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null,
  user_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  foreign key (pack_id, user_id) references public.pack_members (pack_id, user_id) on delete cascade,
  check (ends_on >= starts_on),
  -- A member's pauses never overlap.
  exclude using gist (
    pack_id with =,
    user_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  )
);

create table public.feeds (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null,
  user_id uuid not null,
  -- Cleared when the photo is deleted after 30 days; the feed item stays.
  photo_path text,
  caption text check (char_length(caption) <= 80),
  day date not null,
  is_extra boolean not null default false,
  focus_minutes smallint check (focus_minutes between 1 and 600),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  foreign key (pack_id, user_id) references public.pack_members (pack_id, user_id) on delete cascade
);
-- One counted feed per member per day, enforced here so a double tap cannot create two.
create unique index one_counted_feed_per_day on public.feeds (pack_id, user_id, day) where not is_extra;
create index feeds_pack_recent on public.feeds (pack_id, created_at desc);

create table public.reactions (
  feed_id uuid not null references public.feeds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji public.reaction_emoji not null,
  created_at timestamptz not null default now(),
  primary key (feed_id, user_id)
);

create table public.day_passes (
  pack_id uuid not null,
  user_id uuid not null,
  day date not null,
  kind public.day_pass_kind not null,
  month date not null generated always as (date_trunc('month', day::timestamp)::date) stored,
  created_at timestamptz not null default now(),
  primary key (pack_id, user_id, day),
  foreign key (pack_id, user_id) references public.pack_members (pack_id, user_id) on delete cascade
);
create unique index one_joker_per_month on public.day_passes (pack_id, user_id, month) where kind = 'joker';

create table public.day_results (
  pack_id uuid not null references public.packs (id) on delete cascade,
  day date not null,
  result public.day_type not null,
  -- False for an egg day that did not hatch the egg.
  applied boolean not null,
  fed_ids uuid[] not null default '{}',
  rested_ids uuid[] not null default '{}',
  joker_ids uuid[] not null default '{}',
  paused_ids uuid[] not null default '{}',
  sleeping_ids uuid[] not null default '{}',
  missed_ids uuid[] not null default '{}',
  health_before smallint not null,
  health_after smallint not null,
  early_bird boolean not null default false,
  full_house boolean not null default false,
  night_owl_feeds smallint not null default 0,
  closed_at timestamptz not null default now(),
  -- Also the guard against closing the same day twice.
  primary key (pack_id, day)
);

create table public.achievements (
  pack_id uuid not null references public.packs (id) on delete cascade,
  key public.achievement_key not null,
  unlocked_at timestamptz not null default now(),
  primary key (pack_id, key)
);

create table public.nudges (
  pack_id uuid not null,
  from_user uuid not null,
  to_user uuid not null,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (pack_id, from_user, to_user, day),
  check (from_user <> to_user),
  foreign key (pack_id, from_user) references public.pack_members (pack_id, user_id) on delete cascade,
  foreign key (pack_id, to_user) references public.pack_members (pack_id, user_id) on delete cascade
);

create table public.name_suggestions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null,
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 20),
  created_at timestamptz not null default now(),
  foreign key (pack_id, user_id) references public.pack_members (pack_id, user_id) on delete cascade
);

create table public.weekly_recaps (
  pack_id uuid not null references public.packs (id) on delete cascade,
  week_start date not null,
  stats jsonb not null,
  -- References, not a rendered image, so deleting an account removes its photos from recaps too.
  feed_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (pack_id, week_start)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.feeds (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  unique (feed_id, reporter_id)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- Outbox: every action that notifies someone writes a row here in its own transaction,
-- and the send-push function delivers pending rows.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id uuid references public.packs (id) on delete cascade,
  type public.notification_type not null,
  payload jsonb not null default '{}'::jsonb,
  status public.notification_status not null default 'pending',
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notifications_pending on public.notifications (send_after) where status = 'pending';

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  platform public.push_platform not null,
  updated_at timestamptz not null default now()
);

-- Read-only tokens for home screen widgets; only a hash is stored.
create table public.widget_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
