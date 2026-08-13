-- Phase 6 — economic calendar.
--
-- Safe to re-run. Run in the Supabase SQL editor after phase5.sql.
--
-- ── On where the data comes from ───────────────────────────────────────────
-- This table is deliberately provider-agnostic. Economic calendar feeds differ
-- in licensing — some forbid redisplay, some require attribution, some are
-- scraped and will break — and that choice belongs to whoever runs this app,
-- not to the schema.
--
-- `calendar_bridge/import_events.py` writes into this table from either a
-- normalized JSON file or a provider adapter. Adding a provider is one small
-- file; nothing here or in the UI changes.

create table if not exists public.economic_events (
  id          uuid primary key default gen_random_uuid(),

  -- When the release happens, always stored in UTC. The UI converts to the
  -- user's timezone preference at render.
  event_at    timestamptz not null,
  -- ISO currency the release affects, e.g. 'USD'. Drives the flag and filter.
  currency    text not null,
  country     text,
  title       text not null,
  impact      text not null default 'low' check (impact in ('high', 'medium', 'low')),

  -- Kept as text, not numeric: releases are published as '3.2%', '250K',
  -- '-0.1%' and similar. Parsing them into numbers would lose the unit and
  -- invent precision the source never gave.
  actual      text,
  forecast    text,
  previous    text,

  -- Which feed this row came from, so a bad import can be identified and
  -- replaced without touching rows from another source.
  source      text not null default 'manual',
  -- Stable id from the provider when it offers one; used for idempotent
  -- upserts so re-importing a day never duplicates it.
  external_id text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.economic_events is
  'Economic calendar releases. Shared reference data, not per-user. Populated by calendar_bridge/.';
comment on column public.economic_events.actual is
  'Published value as text — releases carry units ("3.2%", "250K") that a numeric column would destroy.';

-- Re-importing the same window must update rather than duplicate.
--
-- One unique key, not two, and deliberately NOT a partial index: PostgREST's
-- upsert (and plain ON CONFLICT) cannot infer a partial index, so a
-- `where external_id is not null` variant fails at runtime with "no unique or
-- exclusion constraint matching the ON CONFLICT specification".
--
-- The importer always sets `external_id`, falling back to a deterministic key
-- built from the release itself when the provider gives no id, so this single
-- index covers both cases. Rows inserted by hand may leave it null; Postgres
-- treats nulls as distinct, so those simply aren't deduplicated.
create unique index if not exists economic_events_external_uniq
  on public.economic_events (source, external_id);

create index if not exists economic_events_at_idx on public.economic_events (event_at);
create index if not exists economic_events_impact_idx on public.economic_events (impact, event_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Unlike trades, this is shared reference data: every signed-in user reads the
-- same calendar. Nobody writes it from the browser — the importer runs with
-- the service role, which bypasses RLS — so there is deliberately no insert,
-- update or delete policy. A client that could write here could feed every
-- user of the app false economic data.
alter table public.economic_events enable row level security;

drop policy if exists "economic events - read" on public.economic_events;

create policy "economic events - read" on public.economic_events
  for select using (auth.role() = 'authenticated');
