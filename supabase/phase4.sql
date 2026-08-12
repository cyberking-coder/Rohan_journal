-- Phase 4 — user profile & preferences.
--
-- Preferences work from localStorage alone; this table is what makes them
-- follow the user across devices. Safe to re-run.
--
-- Run in the Supabase SQL editor after phase3.sql.

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  -- Reserved for the editable display name and bio that arrive with the
  -- public profile in phase 9. Until then name and avatar come from Google.
  display_name text,
  bio          text,
  -- The whole preferences object as JSON rather than a column per setting:
  -- these are read and written together, never queried individually, and a
  -- new toggle shouldn't need a migration.
  preferences  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on column public.profiles.preferences is
  'Theme, streamer mode, currency, timezone, notification toggles, dismissed notifications.';

alter table public.profiles enable row level security;

-- Drop-then-create so this script is safe to re-run.
drop policy if exists "own profile - select" on public.profiles;
drop policy if exists "own profile - insert" on public.profiles;
drop policy if exists "own profile - update" on public.profiles;

create policy "own profile - select" on public.profiles
  for select using (auth.uid() = id);
create policy "own profile - insert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "own profile - update" on public.profiles
  for update using (auth.uid() = id);

-- No delete policy: a profile should go away with its auth user, which the
-- cascade above already handles.
